import type { SessionWithCategory } from "../../api/types";
import type { SessionGroup } from "./sidebar.types";
import { LIVE_STATUS_ORDER } from "./sidebar.constants";

/**
 * Last meaningful activity. `updatedAt` is bumped on every status transition
 * (and rename/rate/move), so it reads as "time since this session last did
 * something" — the right clock for both zones, unlike `startedAt` (creation).
 */
const activityTime = (s: SessionWithCategory): number =>
  new Date(s.session.updatedAt).getTime();

/**
 * Blocked, waiting or active — the states that belong in the pinned "Active
 * sessions" zone (Claude has a process running, or is halted on the user).
 */
export function isLive(s: SessionWithCategory): boolean {
  const st = s.session.status;
  return st === "active" || st === "waiting" || st === "blocked";
}

/**
 * The search predicate for the project zone. Project name isn't matchable —
 * search only ever narrows a single project's sessions, so matching on the name
 * every row already shares would be a no-op.
 */
export function matchesQuery(s: SessionWithCategory, q: string): boolean {
  if (!q) return true;
  return (
    s.session.slug.toLowerCase().includes(q) ||
    s.session.name.toLowerCase().includes(q) ||
    s.categoryPath.toLowerCase().includes(q)
  );
}

/**
 * Zone A's rows: every live session, ordered blocked-first (halted awaiting
 * approval), then waiting, then active, and by most-recent activity within a
 * status.
 *
 * Deliberately fed the *unscoped*, unsearched session list. "Active sessions"
 * is a cross-project inbox — a session blocked on you in another project must
 * still surface while you're looking at this one — which is exactly what the
 * project selector and search below it must not narrow.
 */
export function selectLiveSessions(
  sessions: SessionWithCategory[],
): SessionWithCategory[] {
  return sessions.filter(isLive).sort((a, b) => {
    const pa = LIVE_STATUS_ORDER.indexOf(a.session.status);
    const pb = LIVE_STATUS_ORDER.indexOf(b.session.status);
    if (pa !== pb) return pa - pb;
    return activityTime(b) - activityTime(a);
  });
}

/**
 * Zone A's groups: live sessions bucketed by owning project. Takes the list
 * `selectLiveSessions` already prioritised and preserves first-seen order, so
 * the group holding the most urgent session floats to the top and rows keep
 * blocked-before-waiting-before-active order inside it. Re-sorting here would
 * throw that away.
 *
 * The project header is the only place a live row's project is named now, so a
 * row that arrived without one is bucketed rather than dropped — it would
 * otherwise vanish from the one zone that must never hide anything.
 */
export function groupByProject(
  sessions: SessionWithCategory[],
): SessionGroup[] {
  const byProject = new Map<string, SessionGroup>();
  for (const s of sessions) {
    const key = s.project?.slug ?? "";
    const group = byProject.get(key);
    if (group) group.sessions.push(s);
    else {
      byProject.set(key, {
        key,
        label: s.project?.name ?? "Unknown project",
        sessions: [s],
      });
    }
  }
  return Array.from(byProject.values());
}

/**
 * Zone B's rows: everything that isn't live (paused, plus archived when shown),
 * grouped by category path. Each group is sorted by most-recent activity, and
 * the groups themselves are ordered by their most recently active session, so
 * the category you touched last floats up.
 *
 * Live sessions are dropped here rather than duplicated — they're already
 * pinned in zone A. Keying on the category path alone is safe because this zone
 * only ever holds one project's sessions.
 */
export function groupByCategory(
  sessions: SessionWithCategory[],
): SessionGroup[] {
  const byCategory = new Map<string, SessionWithCategory[]>();
  for (const s of sessions) {
    if (isLive(s)) continue;
    const key = s.categoryPath;
    const list = byCategory.get(key);
    if (list) list.push(s);
    else byCategory.set(key, [s]);
  }

  const groups = Array.from(byCategory, ([key, list]): SessionGroup => {
    list.sort((a, b) => activityTime(b) - activityTime(a));
    return { key, label: key, sessions: list };
  });
  groups.sort(
    (a, b) => activityTime(b.sessions[0]) - activityTime(a.sessions[0]),
  );
  return groups;
}
