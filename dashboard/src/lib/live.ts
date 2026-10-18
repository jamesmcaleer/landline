"use client";

// Live dashboard state. One WebSocket (/ws/dashboard) carries stored events (replayed on connect),
// screencast frames, and network frames; /connections is the source of truth for which sites exist.

import { useSyncExternalStore } from "react";
import type { Connection, EventEnvelope, NetworkFrame, Site } from "@landline/shared";

export type ApprovalState = "pending" | "approved" | "declined";

export interface ApprovalView {
  id: string;
  summary: string;
  status: ApprovalState;
  requestedAt: number;
  resolvedAt: number | null;
}

export interface ActionView { tool: string; target: string; write: boolean; ts: number }
export interface StepView { text: string; ts: number }

/** One entry in the call transcript. */
export interface LineView {
  who: "caller" | "landline" | "caretaker";
  tone: "plain" | "held" | "ok" | "bad";
  text: string;
  ts: number;
}

export interface IdentityView {
  ip: string;
  asn: string;
  city: string;
  proxy: "residential" | "direct";
  browser: string;
  chMatch: boolean;
  webdriver: boolean;
}

export interface SiteState {
  id: string;
  site: Site | null;
  loggedIn: boolean | null;
  busy: boolean; // between task.started and its done / error / question
  frame: string | null; // latest JPEG, base64
  pageUrl: string | null; // latest top-level document the browser loaded
  steps: StepView[];
  actions: ActionView[];
  lines: LineView[];
  approvals: ApprovalView[];
  net: NetworkFrame[];
  identity: IdentityView | null;
}

export interface LiveState {
  online: boolean;
  order: string[]; // connection ids, from /connections
  sites: Map<string, SiteState>;
}

const MAX_STEPS = 60;
const MAX_ACTIONS = 400;
const MAX_LINES = 80;
const MAX_NET = 400;

// The page is served by the backend, so the same origin reaches the API. In `next dev`
// on another port, set NEXT_PUBLIC_LANDLINE_ORIGIN=http://localhost:3000.
const ORIGIN = process.env.NEXT_PUBLIC_LANDLINE_ORIGIN ?? "";

function emptySite(id: string): SiteState {
  return { id, site: null, loggedIn: null, busy: false, frame: null, pageUrl: null, steps: [], actions: [], lines: [], approvals: [], net: [], identity: null };
}

function push<T>(list: T[], item: T, max: number): T[] {
  const next = list.length >= max ? list.slice(list.length - max + 1) : list.slice();
  next.push(item);
  return next;
}

class LiveStore {
  state: LiveState = { online: false, order: [], sites: new Map() };
  private listeners = new Set<() => void>();
  private ws: WebSocket | null = null;
  private lastEventId = 0;
  private started = false;
  private queued = false;
  private retry = 0;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    this.start();
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.state;

  /** Batches updates to one notify per animation frame; frames and bursts of network traffic arrive fast. */
  private changed() {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.state = { ...this.state };
      for (const fn of this.listeners) fn();
    });
  }

  private site(id: string): SiteState {
    let s = this.state.sites.get(id);
    if (!s) {
      s = emptySite(id);
      this.state.sites.set(id, s);
    }
    return s;
  }

  private update(id: string, patch: (s: SiteState) => Partial<SiteState>) {
    const s = this.site(id);
    this.state.sites.set(id, { ...s, ...patch(s) });
    this.changed();
  }

  private start() {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    void this.refreshConnections();
    this.connect();
  }

  private async refreshConnections() {
    try {
      const res = await fetch(`${ORIGIN}/connections`);
      const { connections } = (await res.json()) as { connections: Connection[] };
      for (const c of connections) {
        const s = this.site(c.id);
        this.state.sites.set(c.id, { ...s, site: c.site, loggedIn: c.loggedIn });
      }
      this.state.order = connections.map((c) => c.id);
      this.changed();
    } catch {
      // The socket's reconnect loop retries this.
    }
  }

  private connect() {
    const base = ORIGIN || window.location.origin;
    const url = `${base.replace(/^http/, "ws")}/ws/dashboard?since=${this.lastEventId}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.state.online = true;
      this.changed();
      void this.refreshConnections();
    };
    ws.onmessage = (m) => this.receive(JSON.parse(String(m.data)));
    ws.onclose = () => {
      this.state.online = false;
      this.changed();
      const delay = Math.min(8000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }

  private receive(msg: EventEnvelope | { type: "frame"; connectionId: string; jpeg: string } | NetworkFrame) {
    if ("event" in msg) return this.apply(msg);
    if (msg.type === "frame") return this.update(msg.connectionId, () => ({ frame: msg.jpeg }));
    if (msg.type === "net") {
      return this.update(msg.connectionId, (s) => ({
        net: push(s.net, msg, MAX_NET),
        pageUrl: msg.resourceType === "Document" ? msg.url : s.pageUrl,
      }));
    }
  }

  private apply({ id: eventId, ts: iso, event: e }: EventEnvelope) {
    this.lastEventId = Math.max(this.lastEventId, eventId);
    const ts = Date.parse(iso);
    switch (e.type) {
      case "connection.created":
      case "connection.ready":
        void this.refreshConnections();
        if (e.type === "connection.ready") this.update(e.connectionId, () => ({ loggedIn: e.loggedIn }));
        return;
      case "connection.removed":
        this.state.sites.delete(e.connectionId);
        this.state.order = this.state.order.filter((id) => id !== e.connectionId);
        return this.changed();
      case "task.started":
        return this.update(e.connectionId, (s) => ({ busy: true, lines: push(s.lines, { who: "caller", tone: "plain", text: e.text, ts }, MAX_LINES) }));
      case "task.step":
        return this.update(e.connectionId, (s) => ({ steps: push(s.steps, { text: e.text, ts }, MAX_STEPS) }));
      case "task.done":
        return this.update(e.connectionId, (s) => ({ busy: false, lines: push(s.lines, { who: "landline", tone: "plain", text: e.text, ts }, MAX_LINES) }));
      case "task.question":
        return this.update(e.connectionId, (s) => ({ busy: false, lines: push(s.lines, { who: "landline", tone: "plain", text: e.text, ts }, MAX_LINES) }));
      case "task.error":
        return this.update(e.connectionId, (s) => ({ busy: false, lines: push(s.lines, { who: "landline", tone: "bad", text: `Stopped: ${e.text}`, ts }, MAX_LINES) }));
      case "agent.action":
        return this.update(e.connectionId, (s) => ({ actions: push(s.actions, { tool: e.tool, target: e.target, write: e.write, ts }, MAX_ACTIONS) }));
      case "approval.requested":
        return this.update(e.connectionId, (s) => ({
          approvals: [...s.approvals, { id: e.approvalId, summary: e.summary, status: "pending", requestedAt: ts, resolvedAt: null }],
          lines: push(s.lines, { who: "caretaker", tone: "held", text: e.summary, ts }, MAX_LINES),
        }));
      case "approval.resolved": {
        const status: ApprovalState = e.status === "approved" ? "approved" : "declined";
        return this.update(e.connectionId, (s) => ({
          approvals: s.approvals.map((a) => (a.id === e.approvalId ? { ...a, status, resolvedAt: ts } : a)),
          lines: push(s.lines, { who: "caretaker", tone: status === "approved" ? "ok" : "bad", text: status === "approved" ? "Approved with Face ID" : e.message ? `Declined: ${e.message}` : "Declined", ts }, MAX_LINES),
        }));
      }
      case "connection.identity": {
        const { type: _t, connectionId, ...identity } = e;
        return this.update(connectionId, () => ({ identity }));
      }
    }
  }
}

const store = new LiveStore();
const serverSnapshot: LiveState = { online: false, order: [], sites: new Map() };

export function useLive(): LiveState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => serverSnapshot);
}

/** The approval currently holding the site, if any. */
export function pendingApproval(s: SiteState): ApprovalView | null {
  for (let i = s.approvals.length - 1; i >= 0; i--) if (s.approvals[i].status === "pending") return s.approvals[i];
  return null;
}
