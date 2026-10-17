import type http from "node:http";
import { Router } from "express";
import { WebSocketServer } from "ws";
import type { EventsResult } from "@landline/shared";
import { events, onEvent } from "../store.js";

export const eventsRouter = Router();

eventsRouter.get("/events", (req, res) => {
  const since = Number(req.query.since ?? 0);
  const body: EventsResult = { events: events.filter((e) => e.id > (Number.isFinite(since) ? since : 0)) };
  res.json(body);
});

/** Forwards every emitted event as JSON to each dashboard socket. */
export function attachDashboardSocket(server: http.Server): void {
  const wss = new WebSocketServer({ server, path: "/ws/dashboard" });
  onEvent((envelope) => {
    const message = JSON.stringify(envelope);
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(message);
    }
  });
}
