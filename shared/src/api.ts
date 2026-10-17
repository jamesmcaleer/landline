import type { SessionExport } from "./session.js";
import type { EventEnvelope } from "./events.js";

export type ApprovalKind = "payment" | "plan_change" | "order" | "settings" | "other";
export type ApprovalStatus = "pending" | "approved" | "declined";

export interface Site { domain: string; title: string; favIconUrl: string; url: string }

export interface Connection {
  id: string;                   // "con_" + 12 random chars
  site: Site;
  loggedIn: boolean | null;     // null while the browser starts
  createdAt: string;            // ISO 8601
}

export interface Approval {
  id: string;                   // "apr_" + 12 random chars
  connectionId: string;
  summary: string;              // one line, plain English, shown on the phone
  kind: ApprovalKind;
  status: ApprovalStatus;
  message: string | null;       // decline message, "expired", or "connection removed"
  createdAt: string;
  expiresAt: string;            // createdAt + 10 minutes
}

export interface ApiError { error: string }

export interface ConfigResult { phone: string; smsLink: string }
export interface CreateConnectionArgs { site: Site }
export interface SessionUploadArgs { encoding: "plain"; session: SessionExport }
export interface ConnectionResult { connection: Connection }
export interface ConnectionsResult { connections: Connection[] }

export interface CreateApprovalArgs { connectionId: string; summary: string; kind: ApprovalKind }
export interface ApprovalResult { approval: Approval }
export interface EventsResult { events: EventEnvelope[] }
