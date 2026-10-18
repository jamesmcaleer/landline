import { Router } from "express";
import type { ApiError, SendActionArgs, SendActionResult, StopActionArgs } from "@landline/shared";
import { peekAgent, sendAction, waitForTurnEvent } from "../services.js";
import { connections } from "../store.js";

export const actionsRouter = Router();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

actionsRouter.post("/actions", async (req, res) => {
  const body: unknown = req.body;
  if (!isRecord(body) || typeof body.connectionId !== "string" || typeof body.query !== "string" || !body.query.trim()) {
    res.status(400).json({ error: "body must be { connectionId, query }" } satisfies ApiError);
    return;
  }
  const args = body as unknown as SendActionArgs;
  if (!connections.has(args.connectionId)) {
    res.status(404).json({ error: "connection not found" } satisfies ApiError);
    return;
  }
  try {
    await sendAction(args.connectionId, args.query.trim());
  } catch (err) {
    if (err instanceof Error && err.message === "busy") {
      res.status(409).json({ error: "action in progress" } satisfies ApiError);
    } else if (err instanceof Error && err.message === "connection not found") {
      res.status(404).json({ error: "connection not found" } satisfies ApiError);
    } else {
      console.error("Could not start action:", err);
      res.status(500).json({ error: "could not start agent" } satisfies ApiError);
    }
    return;
  }
  res.status(202).json({ accepted: true } satisfies SendActionResult);
});

actionsRouter.post("/actions/stop", async (req, res) => {
  const body: unknown = req.body;
  if (!isRecord(body) || typeof body.connectionId !== "string") {
    res.status(400).json({ error: "body must be { connectionId }" } satisfies ApiError);
    return;
  }
  const args = body as unknown as StopActionArgs;
  if (!connections.has(args.connectionId)) {
    res.status(404).json({ error: "connection not found" } satisfies ApiError);
    return;
  }
  await peekAgent(args.connectionId)?.stop();
  res.status(204).end();
});

actionsRouter.get("/actions/wait", async (req, res) => {
  const connectionId = typeof req.query.connectionId === "string" ? req.query.connectionId : "";
  if (!connections.has(connectionId)) {
    res.status(404).json({ error: "connection not found" } satisfies ApiError);
    return;
  }
  const requested = Number(req.query.timeout ?? 25000);
  const timeout = Number.isFinite(requested) ? Math.min(Math.max(requested, 0), 25000) : 25000;
  res.json({ event: await waitForTurnEvent(connectionId, timeout) });
});
