import { parseDbTime } from "@/lib/format";
import type { SessionListRow, SessionStatus } from "@/types";

/**
 * Statuses where Claude is engaged with the session right now — working
 * (`active`), halted on an AskUserQuestion (`waiting`), or halted on a
 * permission approval (`blocked`). Mirrors LIVE_STATUSES in
 * src/db/queries/sessions.ts and isLiveStatus in the dashboard.
 *
 * A live session belongs to another process (a second terminal, or the
 * dashboard), so the launch screen lists it but never offers to resume it.
 */
const LIVE_STATUSES: ReadonlySet<SessionStatus> = new Set([
  "active",
  "waiting",
  "blocked",
]);

export function isLiveStatus(status: SessionStatus): boolean {
  return LIVE_STATUSES.has(status);
}

/**
 * Display order for the launch picker. Live rows lead: a session running right
 * now is the one the user opened the screen to check on, and it must be visible
 * without scrolling. Within live, the dashboard's blocked → waiting → active
 * order puts the session halted on the user first. Paused rows — the ones this
 * screen can actually resume — follow, and archived rows trail when shown.
 * The cursor skips live rows, so leading with them costs no keypresses.
 */
const STATUS_RANK: Record<SessionStatus, number> = {
  blocked: 0,
  waiting: 1,
  active: 2,
  paused: 3,
  archived: 4,
};

/**
 * Newest-activity sort key, as epoch ms rather than the stored string. The
 * columns are written in different shapes — `startedAt` is a `datetime('now')`
 * default, `endedAt` was ISO until 0.42 — and comparing those as text sorts on
 * the separator (" " before "T") rather than on the time.
 *
 * A live row reads `updatedAt`: it has no `endedAt` yet, and `startedAt` is
 * when the session was first created, which for a resumed session can be days
 * before the run happening right now. Every hook status flip bumps `updatedAt`,
 * so it is the honest "last activity" for a session in progress.
 */
export function recencyMs(row: SessionListRow): number {
  const s = row.session;
  if (isLiveStatus(s.status)) return parseDbTime(s.updatedAt);
  return parseDbTime(s.endedAt ?? s.startedAt);
}

/**
 * The rows the launch picker renders, in display order. Every non-archived
 * session is shown — a session that is running in another terminal is still a
 * session the user has, and hiding it made the list read as incomplete.
 * Archived rows appear only when the user toggles them on.
 */
export function visibleLaunchSessions(
  rows: SessionListRow[],
  showArchived: boolean,
): SessionListRow[] {
  return rows
    .filter((r) => r.session.status !== "archived" || showArchived)
    .sort((a, b) => {
      const rank = STATUS_RANK[a.session.status] - STATUS_RANK[b.session.status];
      if (rank !== 0) return rank;
      return recencyMs(b) - recencyMs(a);
    });
}

/** How many visible rows sit in each status, for the header summary. */
export function countByStatus(
  rows: SessionListRow[],
): Record<SessionStatus, number> {
  const counts: Record<SessionStatus, number> = {
    active: 0,
    waiting: 0,
    blocked: 0,
    paused: 0,
    archived: 0,
  };
  for (const r of rows) counts[r.session.status]++;
  return counts;
}
