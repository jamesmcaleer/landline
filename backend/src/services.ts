// Operations shared by several routers: resolving approvals and removing connections.
import type { ApprovalStatus, Connection } from "@landline/shared";
import { createConnectionAgent, type ConnectionAgent } from "./agent/droid.js";
import { getProvider } from "./browser/provider.js";
import { approvals, connections, emit, save, type StoredConnection } from "./store.js";

const waiters = new Map<string, Array<() => void>>();

/** Calls `fn` once when the approval is resolved. Returns a function that cancels the wait. */
export function waitForResolution(approvalId: string, fn: () => void): () => void {
  const list = waiters.get(approvalId) ?? [];
  list.push(fn);
  waiters.set(approvalId, list);
  return () => {
    const current = waiters.get(approvalId);
    if (!current) return;
    const rest = current.filter((f) => f !== fn);
    if (rest.length > 0) waiters.set(approvalId, rest);
    else waiters.delete(approvalId);
  };
}

/** Marks a pending approval as approved or declined. Does nothing if it is already resolved. */
export function resolveApproval(approvalId: string, status: Exclude<ApprovalStatus, "pending">, message: string | null): void {
  const approval = approvals.get(approvalId);
  if (!approval || approval.status !== "pending") return;
  approval.status = status;
  approval.message = message;
  save();
  emit({ type: "approval.resolved", connectionId: approval.connectionId, approvalId, status, message });
  const list = waiters.get(approvalId) ?? [];
  waiters.delete(approvalId);
  for (const wake of list) wake();
}

const agents = new Map<string, ConnectionAgent>();
const agentStarts = new Map<string, Promise<ConnectionAgent>>();

/** The agent if one has been created, without creating it. */
export function peekAgent(connectionId: string): ConnectionAgent | undefined {
  return agents.get(connectionId);
}

/** Returns the connection's agent, creating it on first use. */
export function getAgent(connectionId: string): Promise<ConnectionAgent> {
  const existing = agents.get(connectionId);
  if (existing) return Promise.resolve(existing);
  const starting = agentStarts.get(connectionId);
  if (starting) return starting;
  const connection = connections.get(connectionId);
  if (!connection) return Promise.reject(new Error("connection not found"));
  const promise = createConnectionAgent({ connectionId, cdpUrl: connection.cdpUrl })
    .then(async (agent) => {
      if (!connections.has(connectionId)) {
        await agent.close();
        throw new Error("connection not found");
      }
      agents.set(connectionId, agent);
      return agent;
    })
    .finally(() => agentStarts.delete(connectionId));
  agentStarts.set(connectionId, promise);
  return promise;
}

/** The public view of a stored connection: no cdpUrl, no session. */
export function toPublicConnection(c: StoredConnection): Connection {
  return { id: c.id, site: c.site, loggedIn: c.loggedIn, state: agents.get(c.id)?.state() ?? "idle", createdAt: c.createdAt };
}

export async function removeConnection(connectionId: string): Promise<void> {
  const connection = connections.get(connectionId);
  if (!connection) return;
  const agent = agents.get(connectionId);
  agents.delete(connectionId);
  await agent?.close().catch((err) => console.error(`Could not close agent for ${connectionId}:`, err));
  for (const approval of approvals.values()) {
    if (approval.connectionId === connectionId) resolveApproval(approval.id, "declined", "connection removed");
  }
  try {
    await getProvider().stop(connectionId);
  } catch (err) {
    console.error(`Could not stop browser for ${connectionId}:`, err);
  }
  connections.delete(connectionId);
  save();
  emit({ type: "connection.removed", connectionId });
}
