import { Router } from "express";
import { WebSocketServer } from "ws";
import type { DashboardFrame, EventsResult } from "@landline/shared";
import { events, onEvent } from "../store.js";

export const eventsRouter = Router();

eventsRouter.get("/events", (req, res) => {
  const since = Number(req.query.since ?? 0);
  const body: EventsResult = { events: events.filter((e) => e.id > (Number.isFinite(since) ? since : 0)) };
  res.json(body);
});

export const dashboardServer = new WebSocketServer({ noServer: true });
const lastFrames = new Map<string, string>();

/** Sends a JSON message to every dashboard socket. */
export function broadcastDashboard(obj: unknown): void {
  const message = JSON.stringify(obj);
  for (const client of dashboardServer.clients) {
    if (client.readyState === client.OPEN) client.send(message);
  }
}

/** Remembers the newest frame per connection so a dashboard that connects later sees one at once. */
export function setLastFrame(connectionId: string, frame: DashboardFrame | null): void {
  if (frame) lastFrames.set(connectionId, JSON.stringify(frame));
  else lastFrames.delete(connectionId);
}

export function hasDashboardClients(): boolean {
  return dashboardServer.clients.size > 0;
}

/** Forwards every emitted event as JSON to each dashboard socket. Upgrades are routed from index.ts. */
dashboardServer.on("connection", (socket, request) => {
  // Replay stored events newer than ?since=<id> before any live ones.
  const since = Number(new URL(request.url ?? "", "http://localhost").searchParams.get("since") ?? 0);
  for (const envelope of events) {
    if (envelope.id > (Number.isFinite(since) ? since : 0)) socket.send(JSON.stringify(envelope));
  }
  for (const frame of lastFrames.values()) socket.send(frame);
});
onEvent((envelope) => broadcastDashboard(envelope));
