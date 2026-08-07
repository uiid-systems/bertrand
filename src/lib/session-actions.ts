import {
  getSession,
  setSessionRating,
  deleteSession,
} from "@/db/queries/sessions";
import type { Db } from "@/db/client";
import type { SessionRow, RateReason, DiscardReason } from "@/types";

export type { RateReason, DiscardReason };

export type RateResult =
  | { ok: true; session: SessionRow }
  | { ok: false; reason: RateReason };

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
 * Set (or clear) a session's 1-5 effectiveness rating.
 *
 * Deliberately allowed on a live session: the TUI persists the rating on
 * keypress from its exit screen, but rating is a judgement about the session,
 * not a lifecycle transition, and nothing downstream reads it during a run.
 *
 * `null` clears the rating — the equivalent of the exit screen's 0/backspace.
 */
export function rateSession(
  id: string,
  rating: number | null,
  db?: Db,
): RateResult {
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    return { ok: false, reason: "out-of-range" };
  }

  const session = getSession(id, db);
  if (!session) return { ok: false, reason: "not-found" };

  return { ok: true, session: setSessionRating(id, rating, db) };
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
