import type { SessionWithCategory } from "../../api/types";
import type { SessionGroup, SidebarLayout } from "./sidebar.types";
import { LIVE_STATUS_ORDER } from "./sidebar.constants";

/**
 * Last meaningful activity. `updatedAt` is bumped on every status transition
 * (and rename/rate/move), so it reads as "time since this session last did
 * something" — the right clock for both zones, unlike `startedAt` (creation).
 */
const activityTime = (s: SessionWithCategory): number =>
  new Date(s.session.updatedAt).getTime();

/**
 * Blocked, waiting or active — the states that belong in the pinned "Needs you"
 * zone (a live session: Claude has a process running or is halted on the user).
 */
export function isLive(s: SessionWithCategory): boolean {
  const st = s.session.status;
  return st === "active" || st === "waiting" || st === "blocked";
}

/**
 * Arrange sessions into the two-zone model:
 *  - `live` — active/waiting, across all in-scope projects, ordered
 *    waiting-first (blocked on the user) then by most-recent activity.
 *  - `projects` — everything else (paused, plus archived when shown), grouped
 *    by project. Each group is sorted by most-recent activity, and the groups
 *    themselves are ordered by their most recently active session, so the
 *    project you touched last floats up.
 *
 * Grouping keys on the project, not the category path: two projects that share
 * a category name (e.g. both have a `sidebar` category) must stay separate.
 */
export function buildSidebarLayout(
  sessions: SessionWithCategory[],
): SidebarLayout {
  const live: SessionWithCategory[] = [];
  const rest: SessionWithCategory[] = [];
  for (const s of sessions) {
    (isLive(s) ? live : rest).push(s);
  }

  live.sort((a, b) => {
    const pa = LIVE_STATUS_ORDER.indexOf(a.session.status);
    const pb = LIVE_STATUS_ORDER.indexOf(b.session.status);
    if (pa !== pb) return pa - pb;
    return activityTime(b) - activityTime(a);
  });

  const byProject = new Map<string, SessionWithCategory[]>();
  for (const s of rest) {
    const key = s.project?.slug ?? s.categoryPath;
    const list = byProject.get(key);
    if (list) list.push(s);
    else byProject.set(key, [s]);
  }

  const projects = Array.from(byProject, ([key, list]): SessionGroup => {
    list.sort((a, b) => activityTime(b) - activityTime(a));
    return {
      key,
      category: list[0]?.project?.name ?? list[0]?.categoryPath ?? key,
      sessions: list,
    };
  });
  projects.sort(
    (a, b) => activityTime(b.sessions[0]) - activityTime(a.sessions[0]),
  );

  return { live, projects };
}
