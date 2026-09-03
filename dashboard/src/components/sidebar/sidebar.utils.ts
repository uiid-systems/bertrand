import type { SessionListRow } from "../../api/types";
import type { SessionGroup } from "./sidebar.types";
import { LIVE_STATUS_ORDER } from "./sidebar.constants";

/**
 * Last meaningful activity. `updatedAt` is bumped on every status transition
 * (and rename/rate), so it reads as "time since this session last did
 * something" — the right clock for both zones, unlike `startedAt` (creation).
 */
const activityTime = (s: SessionListRow): number =>
  new Date(s.session.updatedAt).getTime();

/**
 * Blocked, waiting or active — the states that belong in the pinned "Active
 * sessions" zone (Claude has a process running, or is halted on the user).
 */
export function isLive(s: SessionListRow): boolean {
  const st = s.session.status;
  return st === "active" || st === "waiting" || st === "blocked";
}

/**
 * The search predicate. Matches the session's own identity — slug and display
 * name — plus the two fields that say *where* it ran: `repo` and `branch`.
 *
 * Those two are matchable now, where the project name never was. Search used
 * to narrow a single project, so every row shared its name and matching it
 * would have returned the whole list for a query that looked specific. The
 * sidebar spans every repo now, so "everything in tabs-backend" and
 * "whichever session was on ui-505" are exactly the questions being asked —
 * and the branch, not the slug, is what a unit of work is called.
 */
export function matchesQuery(s: SessionListRow, q: string): boolean {
  if (!q) return true;
  const { slug, name, repo, branch } = s.session;
  return [slug, name, repo, branch].some(
    (field) => field != null && field.toLowerCase().includes(q),
  );
}

/**
 * Zone A's rows: every live session, ordered blocked-first (halted awaiting
 * approval), then waiting, then active, and by most-recent activity within a
 * status.
 *
 * Deliberately fed the *unsearched* session list. "Active sessions" is an
 * inbox spanning every repo — a session blocked on you elsewhere must still
 * surface while you're reading another one — which is exactly what the search
 * box below it must not narrow.
 */
export function selectLiveSessions(
  sessions: SessionListRow[],
): SessionListRow[] {
  return sessions.filter(isLive).sort((a, b) => {
    const pa = LIVE_STATUS_ORDER.indexOf(a.session.status);
    const pb = LIVE_STATUS_ORDER.indexOf(b.session.status);
    if (pa !== pb) return pa - pb;
    return activityTime(b) - activityTime(a);
  });
}

/**
 * Label for the bucket holding sessions whose cwd resolved to no repo.
 *
 * An ordinary state, not an error: bertrand records sessions in directories
 * that are not git repos — or are repos with no parseable `origin` — and must
 * keep doing so. The wording says where the session ran rather than what it
 * lacks, and the bucket is ordered with the others rather than exiled.
 */
export const UNGROUPED_LABEL = "Outside a repo";

/** Group key for {@link UNGROUPED_LABEL}. Empty is not a valid `owner/repo`. */
export const UNGROUPED_KEY = "";

/**
 * Bucket sessions by the repo they ran in, preserving the order they arrive in
 * both between groups (first-seen) and within them.
 *
 * `repo` is the rollup axis rather than a checkout path, because a repo's main
 * checkout and every linked worktree hanging off it share one `owner/repo`
 * read from `origin` — so a stack of workspaces on the same project collapses
 * into the one heading a human would draw. `src/lib/session-key.ts` owns the
 * derivation; this only reads the column.
 *
 * First-seen order is load-bearing for zone A, which hands this the list
 * `selectLiveSessions` already prioritised: the group holding the most urgent
 * session floats to the top and rows keep blocked-before-waiting-before-active
 * order inside it. Re-sorting here would throw that away. Callers that want a
 * different order (zone B sorts groups by recency) sort the input.
 *
 * A row whose `repo` is null is bucketed, never dropped — the zones must not
 * hide a session because its cwd was not a repo.
 */
export function groupByRepo(sessions: SessionListRow[]): SessionGroup[] {
  const byRepo = new Map<string, SessionGroup>();
  for (const s of sessions) {
    const key = s.session.repo ?? UNGROUPED_KEY;
    const group = byRepo.get(key);
    if (group) {
      group.sessions.push(s);
      continue;
    }
    byRepo.set(key, {
      key,
      label: key === UNGROUPED_KEY ? UNGROUPED_LABEL : key,
      sessions: [s],
    });
  }
  return Array.from(byRepo.values());
}

/**
 * Zone B's rows: every session as one flat list, most recently active first.
 * The caller groups the result — {@link groupByRepo} keeps this order inside
 * each bucket, and the bucket order then follows the freshest session in it.
 *
 * Live sessions are normally dropped rather than duplicated — they're already
 * pinned in zone A. `includeLive` is how a search gets them back: zone A ignores
 * the query on purpose (it's a pinned inbox), so if this zone also skipped them
 * a live session would match nothing anywhere and search would look broken to
 * anyone looking for the session they're actually running. While a query is
 * active this zone stops being "everything else" and becomes "results", so a
 * live row appearing in both places is the point.
 */
export function selectSessions(
  sessions: SessionListRow[],
  { includeLive = false }: { includeLive?: boolean } = {},
): SessionListRow[] {
  return sessions
    .filter((s) => includeLive || !isLive(s))
    .sort((a, b) => activityTime(b) - activityTime(a));
}
