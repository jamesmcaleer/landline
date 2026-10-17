import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type {
  ApiError,
  Approval,
  ApprovalKind,
  ApprovalResult,
  CreateApprovalArgs,
  Site,
} from "@landline/shared";
import { sendCallback } from "../callback.js";
import { removeConnection, resolveApproval, waitForResolution } from "../services.js";
import { approvals, connections, emit, newId, passkey, save, setPasskey, type StoredApproval } from "../store.js";

export const approvalsRouter = Router();

const APPROVAL_LIFETIME_MS = 5 * 60 * 1000;
const LONG_POLL_MS = 25_000;
const EXPIRY_CHECK_MS = 5_000;
const APPROVAL_KINDS: readonly ApprovalKind[] = ["payment", "plan_change", "order", "settings", "other"];
const APPROVE_PAGE = fileURLToPath(new URL("../../public/approve.html", import.meta.url));

function publicUrl(): string {
  return process.env.PUBLIC_URL ?? "http://localhost:3000";
}

function toPublicApproval(a: StoredApproval): Approval {
  return {
    id: a.id,
    connectionId: a.connectionId,
    summary: a.summary,
    kind: a.kind,
    status: a.status,
    message: a.message,
    createdAt: a.createdAt,
    expiresAt: a.expiresAt,
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function findByToken(token: string): StoredApproval | undefined {
  const hash = hashToken(token);
  for (const approval of approvals.values()) {
    if (approval.tokenHash === hash) return approval;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// --- background expiry ---

export function startExpiryTimer(): void {
  setInterval(() => {
    const now = Date.now();
    for (const approval of approvals.values()) {
      if (approval.status === "pending" && Date.parse(approval.expiresAt) <= now) {
        resolveApproval(approval.id, "declined", "expired");
      }
    }
  }, EXPIRY_CHECK_MS).unref();
}

// --- API for the agent / dashboard ---

approvalsRouter.post("/approvals", async (req, res) => {
  const body: unknown = req.body;
  if (
    !isRecord(body) ||
    typeof body.connectionId !== "string" ||
    typeof body.summary !== "string" ||
    !body.summary.trim() ||
    !APPROVAL_KINDS.includes(body.kind as ApprovalKind)
  ) {
    res.status(400).json({ error: "body must be { connectionId, summary, kind }" } satisfies ApiError);
    return;
  }
  const args = body as unknown as CreateApprovalArgs;
  if (!connections.has(args.connectionId)) {
    res.status(404).json({ error: "connection not found" } satisfies ApiError);
    return;
  }

  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const approval: StoredApproval = {
    id: newId("apr"),
    connectionId: args.connectionId,
    summary: args.summary.trim(),
    kind: args.kind,
    status: "pending",
    message: null,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + APPROVAL_LIFETIME_MS).toISOString(),
    tokenHash: hashToken(token),
  };
  approvals.set(approval.id, approval);
  save();
  emit({
    type: "approval.requested",
    connectionId: approval.connectionId,
    approvalId: approval.id,
    summary: approval.summary,
    kind: approval.kind,
  });

  const url = `${publicUrl()}/a/${token}`;
  console.log(`Approval ${approval.id} requested: ${approval.summary}\n  ${url}`);
  void sendCallback({ connectionId: approval.connectionId, type: "approval", text: `Approve: ${approval.summary}`, url });

  res.status(201).json({ approval: toPublicApproval(approval) } satisfies ApprovalResult);
});

approvalsRouter.get("/approvals/:id", (req, res) => {
  const approval = approvals.get(req.params.id);
  if (!approval) {
    res.status(404).json({ error: "approval not found" } satisfies ApiError);
    return;
  }
  res.json({ approval: toPublicApproval(approval) } satisfies ApprovalResult);
});

approvalsRouter.get("/approvals/:id/wait", (req, res) => {
  const approval = approvals.get(req.params.id);
  if (!approval) {
    res.status(404).json({ error: "approval not found" } satisfies ApiError);
    return;
  }
  const respond = () => res.json({ approval: toPublicApproval(approval) } satisfies ApprovalResult);
  if (approval.status !== "pending") {
    respond();
    return;
  }
  const cancel = waitForResolution(approval.id, () => {
    clearTimeout(timer);
    respond();
  });
  const timer = setTimeout(() => {
    cancel();
    respond();
  }, LONG_POLL_MS);
  res.on("close", () => {
    clearTimeout(timer);
    cancel();
  });
});

// --- phone page ---

approvalsRouter.get("/a/:token", (_req, res) => {
  res.sendFile(APPROVE_PAGE, { dotfiles: "allow" });
});

/** Finds the approval for a token, or answers 410 when it is unknown, expired or already answered. */
function findOpenApproval(token: string, res: import("express").Response): StoredApproval | undefined {
  const approval = findByToken(token);
  if (!approval || approval.status !== "pending") {
    res.status(410).json({ error: "this request expired or was already answered" } satisfies ApiError);
    return undefined;
  }
  return approval;
}

approvalsRouter.get("/a/:token/state", (req, res) => {
  const approval = findOpenApproval(req.params.token, res);
  if (!approval) return;
  const connection = connections.get(approval.connectionId);
  if (!connection) {
    res.status(410).json({ error: "this request expired or was already answered" } satisfies ApiError);
    return;
  }
  const site: Site = connection.site;
  res.json({ approval: toPublicApproval(approval), site, hasPasskey: passkey !== null });
});

const challenges = new Map<string, string>();

function rpId(): string {
  return new URL(publicUrl()).hostname;
}

approvalsRouter.post("/a/:token/options", async (req, res) => {
  const token = req.params.token;
  if (!findOpenApproval(token, res)) return;

  if (passkey === null) {
    const options = await generateRegistrationOptions({
      rpName: "Landline",
      rpID: rpId(),
      userName: "landline",
      attestationType: "none",
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "preferred",
        userVerification: "required",
      },
    });
    challenges.set(token, options.challenge);
    res.json(options);
    return;
  }

  const options = await generateAuthenticationOptions({
    rpID: rpId(),
    allowCredentials: [{ id: passkey.credentialId }],
    userVerification: "required",
  });
  challenges.set(token, options.challenge);
  res.json(options);
});

/** Verifies the WebAuthn response. Registers the passkey on first use. Returns true when verified. */
async function verifyWebAuthn(token: string, response: unknown): Promise<boolean> {
  const expectedChallenge = challenges.get(token);
  if (!expectedChallenge || !isRecord(response)) return false;
  challenges.delete(token);
  const expectedOrigin = new URL(publicUrl()).origin;
  const expectedRPID = rpId();

  try {
    if (passkey === null) {
      const result = await verifyRegistrationResponse({
        response: response as unknown as RegistrationResponseJSON,
        expectedChallenge,
        expectedOrigin,
        expectedRPID,
        requireUserVerification: true,
      });
      if (!result.verified) return false;
      const { credential } = result.registrationInfo;
      setPasskey({
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: credential.counter,
      });
      return true;
    }

    const result = await verifyAuthenticationResponse({
      response: response as unknown as AuthenticationResponseJSON,
      expectedChallenge,
      expectedOrigin,
      expectedRPID,
      requireUserVerification: true,
      credential: {
        id: passkey.credentialId,
        publicKey: Buffer.from(passkey.publicKey, "base64url"),
        counter: passkey.counter,
      },
    });
    if (!result.verified) return false;
    setPasskey({ ...passkey, counter: result.authenticationInfo.newCounter });
    return true;
  } catch (err) {
    console.error("WebAuthn verification failed:", err);
    return false;
  }
}

approvalsRouter.post("/a/:token/decision", async (req, res) => {
  const token = req.params.token;
  const approval = findOpenApproval(token, res);
  if (!approval) return;

  const body: unknown = req.body;
  const decision = isRecord(body) ? body.decision : undefined;
  if (decision !== "approved" && decision !== "declined" && decision !== "revoked") {
    res.status(400).json({ error: "decision must be approved, declined or revoked" } satisfies ApiError);
    return;
  }
  const message = isRecord(body) && typeof body.message === "string" && body.message.trim() ? body.message.trim() : null;

  if (decision === "declined") {
    resolveApproval(approval.id, "declined", message);
  } else {
    const verified = await verifyWebAuthn(token, (body as Record<string, unknown>).webauthn);
    if (!verified) {
      res.status(403).json({ error: "Face ID check failed" } satisfies ApiError);
      return;
    }
    // Another request may have answered while we verified.
    if (approval.status !== "pending") {
      res.status(410).json({ error: "this request expired or was already answered" } satisfies ApiError);
      return;
    }
    if (decision === "approved") {
      resolveApproval(approval.id, "approved", null);
    } else {
      resolveApproval(approval.id, "declined", "connection revoked");
      await removeConnection(approval.connectionId);
    }
  }
  challenges.delete(token);
  res.json({ approval: toPublicApproval(approval) } satisfies ApprovalResult);
});
