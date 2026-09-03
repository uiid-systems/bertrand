import { getSession, deleteSession } from "@/db/queries/sessions";
import type { Db } from "@/db/client";
import type { DiscardReason } from "@/types";

export type { DiscardReason };

export type DiscardResult =
  | { ok: true }
  | { ok: false; reason: DiscardReason };

/**
 * Statuses that mean a process still owns the session. Mirrors ACTIVE_STATUSES
 * in session-archive.ts and LIVE_STATUSES in db/queries/sessions.ts — keep them
 * in sync when the status enum changes.
 */
const ACTIVE_STATUSES = ["active", "waiting", "blocked"] as const;

function isActive(status: string): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

/**
 * Permanently delete a session and everything cascading from it.
 *
 * Refused while the session is live, for a reason archive shares but discard
 * makes worse: the owning process still holds the id, and the row vanishing
 * underneath it means finalize lands on nothing. `finalizeSessionRow` already
 * tolerates that (it returns early when the session is gone), so the damage is
 * a silently skipped finalize rather than a crash — but the user's intent when
 * they discard a *running* session is to stop it, and deleting the row does
 * not stop anything. Stop it first, then discard.
 */
export function discardSession(id: string, db?: Db): DiscardResult {
  const session = getSession(id, db);
  if (!session) return { ok: false, reason: "not-found" };
  if (isActive(session.status)) return { ok: false, reason: "active" };

  deleteSession(id, db);
  return { ok: true };
}
