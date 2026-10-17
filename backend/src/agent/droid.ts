// One long-lived Droid session per connection, driving that connection's browser.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AutonomyLevel,
  createSdkMcpServer,
  createSession,
  DroidMessageType,
  ToolConfirmationOutcome,
  tool,
  type DroidSession,
} from "@factory/droid-sdk/node";
import { z } from "zod";
import type { AgentState, ApprovalKind, ApprovalResult, ApiError } from "@landline/shared";
import { sendCallback } from "../callback.js";
import { emit } from "../store.js";
import { startNetworkLog } from "./network-log.js";

/** The pinned Droid CLI in backend/bin (fetched by scripts/fetch-droid.sh), unless DROID_EXEC_PATH overrides it. */
function droidExecPath(): string {
  if (process.env.DROID_EXEC_PATH) return process.env.DROID_EXEC_PATH;
  const bundled = fileURLToPath(new URL("../../bin/droid", import.meta.url));
  return existsSync(bundled) ? bundled : "droid";
}

export interface ConnectionAgent {
  send(query: string): Promise<void>;
  stop(): Promise<void>;
  close(): Promise<void>;
  state(): AgentState;
  lastStep(): string | null;
}

export const PLAYWRIGHT_MCP_VERSION = "0.0.83";
const WORK_ROOT = fileURLToPath(new URL("../../work/", import.meta.url));
const TURN_TIMEOUT_MS = 10 * 60 * 1000;
const APPROVAL_WAIT_MS = 6 * 60 * 1000;

const AGENTS_MD = `You operate one website for one user through the Playwright MCP browser tools. The browser is already logged in; never log in or ask for a password. Read anything freely. Before any action that changes something on the site (a payment, a plan change, an order, a setting), call request_approval with a one-line plain-English summary that names what will change and the new value (for example "Change your first name from James to Jame"), and stop if the decision is not approved. network.jsonl in this directory records every XHR and fetch request with bodies; prefer grepping or writing a short script over it to extract data instead of reading pages. If you need information from the user, call ask_user and end your turn. Keep answers short and in plain English for a non-technical person.
`;

function selfUrl(): string {
  return process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
}

function shortArgs(input: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(input) ?? "";
  } catch {
    text = String(input);
  }
  return text.length > 100 ? text.slice(0, 100) + "..." : text;
}

export async function createConnectionAgent(opts: { connectionId: string; cdpUrl: string; workDir?: string }): Promise<ConnectionAgent> {
  const { connectionId, cdpUrl } = opts;
  const workDir = opts.workDir ?? `${WORK_ROOT}${connectionId}/`;
  const log = (...args: unknown[]) => console.log(`[${connectionId}]`, ...args);

  mkdirSync(workDir, { recursive: true });
  writeFileSync(`${workDir}AGENTS.md`, AGENTS_MD);
  const stopNetworkLog = await startNetworkLog(cdpUrl, `${workDir}network.jsonl`).catch((err) => {
    console.error(`[${connectionId}] network log not started:`, err instanceof Error ? err.message : err);
    return () => {};
  });

  let state: AgentState = "idle";
  let lastStep: string | null = null;
  let turnActive = false;
  let askedThisTurn = false;
  let closed = false;
  let cancelled = false; // set by stop() or timeout during the current turn

  const step = (text: string) => {
    lastStep = text;
    emit({ type: "task.step", connectionId, text });
  };

  const landline = createSdkMcpServer({
    name: "landline",
    tools: [
      tool(
        "request_approval",
        "Ask the user to approve an action that changes something on the site. Blocks until they decide. Returns { decision: approved|declined, message }.",
        {
          summary: z.string().describe("One-line plain-English summary of the action"),
          kind: z.enum(["payment", "plan_change", "order", "settings", "other"]),
        },
        async ({ summary, kind }: { summary: string; kind: ApprovalKind }) => {
          const created = await fetch(`${selfUrl()}/approvals`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ connectionId, summary, kind }),
          });
          if (!created.ok) {
            const err = (await created.json().catch(() => ({ error: created.statusText }))) as ApiError;
            return JSON.stringify({ decision: "declined", message: `could not request approval: ${err.error}` });
          }
          const { approval } = (await created.json()) as ApprovalResult;
          state = "waiting_approval";
          const deadline = Date.now() + APPROVAL_WAIT_MS;
          let status = approval.status;
          let message = approval.message;
          try {
            while (status === "pending" && Date.now() < deadline && !cancelled && !closed) {
              const res = await fetch(`${selfUrl()}/approvals/${approval.id}/wait`);
              if (!res.ok) {
                status = "declined";
                message = `approval lookup failed (${res.status})`;
                break;
              }
              ({ status, message } = ((await res.json()) as ApprovalResult).approval);
            }
          } finally {
            if (state === "waiting_approval") state = "working";
          }
          if (status === "pending") return JSON.stringify({ decision: "declined", message: "no answer in time" });
          return JSON.stringify({ decision: status, message });
        },
      ),
      tool(
        "ask_user",
        "Ask the user a question by text message. After calling this, end your turn; the answer arrives as the next message.",
        { question: z.string() },
        async ({ question }: { question: string }) => {
          askedThisTurn = true;
          state = "waiting_user";
          void sendCallback({ connectionId, type: "question", text: question });
          return "The question was sent. End your turn now; the answer arrives as the next message.";
        },
      ),
      tool(
        "report_progress",
        "Tell the user briefly what you are doing right now.",
        { text: z.string() },
        async ({ text }: { text: string }) => {
          step(text);
          void sendCallback({ connectionId, type: "progress", text });
          return "ok";
        },
      ),
    ],
  });

  const session: DroidSession = await createSession({
    cwd: workDir,
    // SDK 0.9.1 needs a Droid CLI with a matching protocol (0.212.1); see backend/README.md.
    execPath: droidExecPath(),
    // Off: ask before every action, so every tool call reaches permissionHandler.
    autonomyLevel: AutonomyLevel.Off,
    mcpServers: [
      {
        name: "playwright",
        command: "npx",
        args: [`@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}`, "--cdp-endpoint", cdpUrl],
        env: {},
      },
      landline,
    ],
    permissionHandler(request) {
      log("permission request:", JSON.stringify(request.toolUses.map((u) => ({ tool: (u as any).toolUse?.name ?? (u as any).name, details: u.details }))));
      return ToolConfirmationOutcome.ProceedOnce;
    },
  });

  async function interrupt(): Promise<void> {
    await session.interrupt().catch((err) => console.error(`[${connectionId}] interrupt failed:`, err instanceof Error ? err.message : err));
  }

  return {
    state: () => state,
    lastStep: () => lastStep,

    async send(query) {
      if (closed || turnActive || (state !== "idle" && state !== "waiting_user")) throw new Error("busy");
      turnActive = true;
      askedThisTurn = false;
      cancelled = false;
      state = "working";
      const startedAt = Date.now();
      log("turn start:", shortArgs(query));
      const timer = setTimeout(() => {
        cancelled = true;
        log("turn timed out");
        emit({ type: "task.error", connectionId, text: "timed out" });
        void sendCallback({ connectionId, type: "error", text: "timed out" });
        void interrupt();
      }, TURN_TIMEOUT_MS);

      void (async () => {
        let finalText = "";
        let failure: string | null = null;
        try {
          for await (const message of session.stream(query, { includePartialMessages: true })) {
            switch (message.type) {
              case DroidMessageType.Assistant:
                if (message.text) {
                  log("assistant:", message.text);
                  finalText = message.text;
                }
                break;
              case DroidMessageType.ToolCall:
                log("tool call:", message.name, shortArgs(message.input));
                step(`${message.name}: ${shortArgs(message.input)}`);
                break;
              case DroidMessageType.Error:
                log("error event:", message.message);
                break;
              case DroidMessageType.Result:
                if (message.text) finalText = message.text;
                if (message.subtype === "error_during_execution" || message.subtype === "error_structured_output") {
                  failure = message.error?.message ?? message.subtype;
                }
                break;
            }
          }
        } catch (err) {
          failure = err instanceof Error ? err.message : String(err);
        } finally {
          clearTimeout(timer);
          turnActive = false;
          state = askedThisTurn && !failure && !cancelled ? "waiting_user" : "idle";
        }
        log(`turn end after ${Math.round((Date.now() - startedAt) / 1000)}s`, failure ? `(error: ${failure})` : "");
        if (cancelled) return; // stop() or the timeout already sent the callback
        if (failure) {
          emit({ type: "task.error", connectionId, text: failure });
          await sendCallback({ connectionId, type: "error", text: failure });
        } else if (finalText) {
          emit({ type: "task.done", connectionId, text: finalText });
          await sendCallback({ connectionId, type: "result", text: finalText });
        }
      })();
    },

    async stop() {
      cancelled = true;
      await interrupt();
      state = "idle";
      emit({ type: "task.error", connectionId, text: "stopped" });
      await sendCallback({ connectionId, type: "error", text: "stopped" });
    },

    async close() {
      closed = true;
      cancelled = true;
      stopNetworkLog();
      await session.close().catch(() => {});
    },
  };
}
