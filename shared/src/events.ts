import type { ApprovalKind, ApprovalStatus } from "./api.js";
export type Event =
  | { type: "connection.created"; connectionId: string; site: string }
  | { type: "connection.ready";   connectionId: string; loggedIn: boolean }
  | { type: "connection.removed"; connectionId: string }
  | { type: "task.step"; connectionId: string; text: string }
  | { type: "task.done"; connectionId: string; text: string }
  | { type: "task.error"; connectionId: string; text: string }
  | { type: "task.question"; connectionId: string; text: string }
  | { type: "task.started"; connectionId: string; text: string }
  | { type: "agent.action"; connectionId: string; tool: string; target: string; write: boolean }
  | { type: "connection.identity"; connectionId: string; ip: string; asn: string; city: string; proxy: "residential" | "direct"; browser: string; chMatch: boolean; webdriver: boolean }
  | { type: "approval.requested"; connectionId: string; approvalId: string; summary: string; kind: ApprovalKind; url: string }
  | { type: "approval.resolved";  connectionId: string; approvalId: string; status: ApprovalStatus; message: string | null };
export interface EventEnvelope { id: number; ts: string; event: Event }

/** A live screencast frame sent over /ws/dashboard. Not an Event: frames are never stored. */
export interface DashboardFrame { type: "frame"; connectionId: string; jpeg: string }

/** A finished network request, sent over /ws/dashboard. Not an Event: never stored. */
export interface NetworkFrame {
  type: "net"; connectionId: string; id: string; ts: string;
  method: string; url: string; status: number; resourceType: string; mimeType: string;
  ms: number;        // requestWillBeSent -> loadingFinished, from CDP timestamps
  size: number;      // encodedDataLength bytes
  timing: { dns: number; connect: number; tls: number; wait: number; download: number } | null; // ms per phase from response.timing; null when absent (cache, data:)
}
