import { randomInt } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Approval, Connection, Event, EventEnvelope, SessionExport } from "@landline/shared";

export type StoredConnection = Omit<Connection, "state"> & { cdpUrl: string; session?: SessionExport; sandboxName?: string; sandboxToken?: string };
export type StoredApproval = Approval & { tokenHash: string };
export interface Passkey { credentialId: string; publicKey: string; counter: number }

const DATA_FILE = process.env.DATA_FILE ?? fileURLToPath(new URL("../data.json", import.meta.url));
const MAX_EVENTS = 1000;
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export const connections = new Map<string, StoredConnection>();
export const approvals = new Map<string, StoredApproval>();
export const events: EventEnvelope[] = [];

export let passkey: Passkey | null = null;

export function setPasskey(next: Passkey | null): void {
  passkey = next;
  save();
}

export function newId(prefix: string): string {
  let suffix = "";
  for (let i = 0; i < 12; i++) suffix += BASE62[randomInt(BASE62.length)];
  return `${prefix}_${suffix}`;
}

// --- events ---

type Listener = (envelope: EventEnvelope) => void;
const listeners = new Set<Listener>();
let lastEventId = 0;

export function emit(event: Event): EventEnvelope {
  const envelope: EventEnvelope = { id: ++lastEventId, ts: new Date().toISOString(), event };
  events.push(envelope);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  for (const listener of listeners) listener(envelope);
  return envelope;
}

export function onEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// --- persistence ---

interface SavedState {
  connections: StoredConnection[];
  approvals: StoredApproval[];
  passkey: Passkey | null;
}

export function save(): void {
  const state: SavedState = {
    connections: [...connections.values()],
    approvals: [...approvals.values()],
    passkey,
  };
  try {
    writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error("Could not write data.json:", err);
  }
}

export function load(): void {
  if (!existsSync(DATA_FILE)) return;
  try {
    const state = JSON.parse(readFileSync(DATA_FILE, "utf8")) as Partial<SavedState>;
    for (const c of state.connections ?? []) connections.set(c.id, c);
    for (const a of state.approvals ?? []) approvals.set(a.id, a);
    passkey = state.passkey ?? null;
    console.log(`Loaded ${connections.size} connections and ${approvals.size} approvals from data.json`);
  } catch (err) {
    console.error("Could not read data.json, starting empty:", err);
  }
}
