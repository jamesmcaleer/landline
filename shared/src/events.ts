import type { ApprovalKind, ApprovalStatus } from "./api.js";
export type Event =
  | { type: "connection.created"; connectionId: string; site: string }
  | { type: "connection.ready";   connectionId: string; loggedIn: boolean }
  | { type: "connection.removed"; connectionId: string }
  | { type: "task.step"; connectionId: string; text: string }
  | { type: "approval.requested"; connectionId: string; approvalId: string; summary: string; kind: ApprovalKind }
  | { type: "approval.resolved";  connectionId: string; approvalId: string; status: ApprovalStatus; message: string | null };
export interface EventEnvelope { id: number; ts: string; event: Event }
