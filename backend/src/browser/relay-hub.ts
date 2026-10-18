// Relay hub: the backend end of the outbound CDP relay that runs in each Chalk sandbox.
//
// A sandbox cannot accept inbound connections, so its relay dials us at /ws/sandbox/:id.
// Clients (Playwright MCP, our CDP client) connect to /cdp/:id and each gets a channel
// multiplexed over that one relay socket.
//
// Frames are JSON text. relay -> hub: hello {chromium}, identity {ip,asn,city,proxy}, msg {ch,d}, close {ch}, ping, pong.
// hub -> relay: open {ch}, msg {ch,d}, close {ch}, ping, pong.

import { createHash, timingSafeEqual } from "node:crypto";
import type http from "node:http";
import type { Duplex } from "node:stream";
import { Router } from "express";
import WebSocket, { WebSocketServer } from "ws";

interface Relay {
  socket: WebSocket;
  chromium: Record<string, unknown> | null;
  channels: Map<number, WebSocket>;
  nextChannel: number;
}

const tokens = new Map<string, string>();
const relays = new Map<string, Relay>();
const connectedListeners = new Map<string, Set<() => void>>();
const relayServer = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 * 1024 });
const clientServer = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 * 1024 });

const sha = (s: string) => createHash("sha256").update(s).digest();

export function registerToken(connectionId: string, token: string): void {
  tokens.set(connectionId, token);
}

export function dropToken(connectionId: string): void {
  tokens.delete(connectionId);
  const relay = relays.get(connectionId);
  if (relay) relay.socket.close();
}

export function isRelayConnected(connectionId: string): boolean {
  const relay = relays.get(connectionId);
  return !!relay && relay.chromium !== null && relay.socket.readyState === WebSocket.OPEN;
}

/** Calls `fn` each time the relay for this connection says hello (first connect and every reconnect). */
export function onRelayConnected(connectionId: string, fn: () => void): () => void {
  let set = connectedListeners.get(connectionId);
  if (!set) connectedListeners.set(connectionId, (set = new Set()));
  set.add(fn);
  return () => set.delete(fn);
}

const anyConnectedListeners = new Set<(connectionId: string) => void>();

/** Like onRelayConnected, for every connection. */
export function onAnyRelayConnected(fn: (connectionId: string) => void): void {
  anyConnectedListeners.add(fn);
}

export interface RelayIdentity { ip: string; asn: string; city: string; proxy: "residential" | "direct" }

const identityListeners = new Set<(connectionId: string, identity: RelayIdentity) => void>();

/** Calls `fn` when a relay reports the network identity (exit IP, ASN, city) of its sandbox. */
export function onRelayIdentity(fn: (connectionId: string, identity: RelayIdentity) => void): void {
  identityListeners.add(fn);
}

/** Resolves when the relay is connected, rejects after `timeoutMs`. */
export function waitForRelay(connectionId: string, timeoutMs: number): Promise<void> {
  if (isRelayConnected(connectionId)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const off = onRelayConnected(connectionId, () => {
      clearTimeout(timer);
      off();
      resolve();
    });
    const timer = setTimeout(() => {
      off();
      reject(new Error(`sandbox relay did not connect within ${timeoutMs / 1000}s`));
    }, timeoutMs);
  });
}

function send(socket: WebSocket, obj: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(obj));
}

function tokenOk(connectionId: string, given: unknown): boolean {
  const expected = tokens.get(connectionId);
  return !!expected && typeof given === "string" && timingSafeEqual(sha(expected), sha(given));
}

function reject(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

/** Handles the `upgrade` for /ws/sandbox/:id and /cdp/:id. Returns false for other paths. */
export function handleHubUpgrade(request: http.IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const path = new URL(request.url ?? "", "http://localhost").pathname;
  const relayMatch = /^\/ws\/sandbox\/([^/]+)$/.exec(path);
  if (relayMatch) {
    const id = decodeURIComponent(relayMatch[1]!);
    if (!tokenOk(id, request.headers["x-landline-token"])) {
      reject(socket, "401 Unauthorized");
      return true;
    }
    relayServer.handleUpgrade(request, socket, head, (ws) => attachRelay(id, ws));
    return true;
  }
  const clientMatch = /^\/cdp\/([^/]+)\/?$/.exec(path);
  if (clientMatch) {
    const id = decodeURIComponent(clientMatch[1]!);
    if (!isRelayConnected(id)) {
      reject(socket, "503 Service Unavailable");
      return true;
    }
    clientServer.handleUpgrade(request, socket, head, (ws) => attachClient(id, ws));
    return true;
  }
  return false;
}

function attachRelay(connectionId: string, socket: WebSocket): void {
  // A new relay replaces an old one (the old socket is probably half-dead).
  relays.get(connectionId)?.socket.terminate();
  const relay: Relay = { socket, chromium: null, channels: new Map(), nextChannel: 1 };
  relays.set(connectionId, relay);

  socket.on("message", (data) => {
    let m: { t?: string; ch?: number; d?: string; chromium?: Record<string, unknown>; ip?: string; asn?: string; city?: string; proxy?: string };
    try {
      m = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (m.t === "hello") {
      relay.chromium = m.chromium ?? {};
      console.log(`Relay for ${connectionId} connected`);
      for (const fn of [...(connectedListeners.get(connectionId) ?? []), ...[...anyConnectedListeners].map((f) => () => f(connectionId))]) {
        try {
          fn();
        } catch (err) {
          console.error("relay listener threw:", err);
        }
      }
    } else if (m.t === "identity") {
      const identity: RelayIdentity = {
        ip: String(m.ip ?? ""),
        asn: String(m.asn ?? ""),
        city: String(m.city ?? ""),
        proxy: m.proxy === "residential" ? "residential" : "direct",
      };
      for (const fn of identityListeners) {
        try {
          fn(connectionId, identity);
        } catch (err) {
          console.error("identity listener threw:", err);
        }
      }
    } else if (m.t === "ping") {
      send(socket, { t: "pong" });
    } else if (m.t === "msg" && typeof m.ch === "number" && typeof m.d === "string") {
      const client = relay.channels.get(m.ch);
      if (client && client.readyState === WebSocket.OPEN) client.send(m.d);
    } else if (m.t === "close" && typeof m.ch === "number") {
      const client = relay.channels.get(m.ch);
      relay.channels.delete(m.ch);
      client?.close();
    }
  });
  socket.on("close", () => {
    if (relays.get(connectionId) === relay) relays.delete(connectionId);
    for (const client of relay.channels.values()) client.close();
    relay.channels.clear();
    console.log(`Relay for ${connectionId} disconnected`);
  });
  socket.on("error", () => {});
}

function attachClient(connectionId: string, client: WebSocket): void {
  const relay = relays.get(connectionId);
  if (!relay) {
    client.close(1013, "relay not connected");
    return;
  }
  const ch = relay.nextChannel++;
  relay.channels.set(ch, client);
  send(relay.socket, { t: "open", ch });
  client.on("message", (data) => send(relay.socket, { t: "msg", ch, d: data.toString() }));
  client.on("close", () => {
    if (relay.channels.delete(ch)) send(relay.socket, { t: "close", ch });
  });
  client.on("error", () => {});
}

/** HTTP probe endpoint for clients that fetch /json/version before opening the websocket. */
export const relayRouter = Router();
relayRouter.get("/cdp/:connectionId/json/version", (req, res) => {
  const id = req.params.connectionId;
  const relay = relays.get(id);
  if (!relay?.chromium || !isRelayConnected(id)) {
    res.status(503).json({ error: "relay not connected" });
    return;
  }
  const port = Number(process.env.PORT ?? 3000);
  res.json({ ...relay.chromium, webSocketDebuggerUrl: `ws://127.0.0.1:${port}/cdp/${id}` });
});
