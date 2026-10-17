import { Router } from "express";
import type {
  ApiError,
  ConfigResult,
  ConnectionResult,
  ConnectionsResult,
  CreateConnectionArgs,
  SessionExport,
  SessionUploadArgs,
  Site,
} from "@landline/shared";
import { getProvider } from "../browser/provider.js";
import { loadSession } from "../browser/session.js";
import { removeConnection, toPublicConnection } from "../services.js";
import { connections, emit, newId, save, type StoredConnection } from "../store.js";

export const connectionsRouter = Router();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSite(value: unknown): Site | null {
  if (!isRecord(value)) return null;
  const { domain, title, favIconUrl, url } = value;
  if (typeof domain !== "string" || !domain) return null;
  if (typeof title !== "string" || typeof favIconUrl !== "string") return null;
  if (typeof url !== "string" || !URL.canParse(url)) return null;
  return { domain, title, favIconUrl, url };
}

function isSessionExport(value: unknown): value is SessionExport {
  if (!isRecord(value)) return false;
  return (
    value.formatVersion === 1 &&
    parseSite(value.site) !== null &&
    isRecord(value.browser) &&
    Array.isArray(value.cookies) &&
    Array.isArray(value.origins)
  );
}

connectionsRouter.get("/config", (_req, res) => {
  const phone = process.env.LANDLINE_PHONE ?? "";
  const body: ConfigResult = { phone, smsLink: "sms:" + phone };
  res.json(body);
});

connectionsRouter.post("/connections", async (req, res) => {
  const body: unknown = req.body;
  const site = isRecord(body) ? parseSite(body.site) : null;
  if (!site) {
    res.status(400).json({ error: "body must be { site: { domain, title, favIconUrl, url } }" } satisfies ApiError);
    return;
  }
  const args: CreateConnectionArgs = { site };

  const id = newId("con");
  let cdpUrl: string;
  try {
    ({ cdpUrl } = await getProvider().start(id));
  } catch (err) {
    console.error("Could not start browser:", err);
    res.status(500).json({ error: "could not start browser" } satisfies ApiError);
    return;
  }

  const connection: StoredConnection = {
    id,
    site: args.site,
    loggedIn: null,
    createdAt: new Date().toISOString(),
    cdpUrl,
  };
  connections.set(id, connection);
  save();
  emit({ type: "connection.created", connectionId: id, site: args.site.domain });
  res.status(201).json({ connection: toPublicConnection(connection) } satisfies ConnectionResult);
});

connectionsRouter.put("/connections/:id/session", async (req, res) => {
  const connection = connections.get(req.params.id);
  if (!connection) {
    res.status(404).json({ error: "connection not found" } satisfies ApiError);
    return;
  }
  const body: unknown = req.body;
  if (!isRecord(body) || body.encoding !== "plain" || !isSessionExport(body.session)) {
    res.status(400).json({ error: 'body must be { encoding: "plain", session: SessionExport }' } satisfies ApiError);
    return;
  }
  const args = body as unknown as SessionUploadArgs;

  let loggedIn: boolean;
  try {
    loggedIn = await loadSession(connection.cdpUrl, args.session);
  } catch (err) {
    console.error("Could not load session:", err);
    res.status(500).json({ error: "could not load session into browser" } satisfies ApiError);
    return;
  }

  // The connection may have been removed while the page was loading.
  if (!connections.has(connection.id)) {
    res.status(404).json({ error: "connection not found" } satisfies ApiError);
    return;
  }
  connection.loggedIn = loggedIn;
  connection.session = args.session;
  save();
  emit({ type: "connection.ready", connectionId: connection.id, loggedIn });
  res.json({ connection: toPublicConnection(connection) } satisfies ConnectionResult);
});

connectionsRouter.get("/connections", (_req, res) => {
  const body: ConnectionsResult = { connections: [...connections.values()].map(toPublicConnection) };
  res.json(body);
});

connectionsRouter.delete("/connections/:id", async (req, res) => {
  if (!connections.has(req.params.id)) {
    res.status(404).json({ error: "connection not found" } satisfies ApiError);
    return;
  }
  await removeConnection(req.params.id);
  res.status(204).end();
});
