// Operations shared by several routers: resolving approvals and removing connections.
import type { ApprovalStatus } from "@landline/shared";
import { getProvider } from "./browser/provider.js";
import { approvals, connections, emit, save } from "./store.js";

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

export async function removeConnection(connectionId: string): Promise<void> {
  const connection = connections.get(connectionId);
  if (!connection) return;
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
