import { parseDbTime } from "@/lib/format";
import type { SessionListRow } from "@/types";

/**
 * Label for the bucket a session with no `repo` falls into.
 *
 * bertrand records sessions in directories that are not repos — or are repos
 * with no parseable `origin` — and must keep doing so, so this is an ordinary
 * state and not an error. The wording says where the session ran rather than
 * what it is missing, and the bucket is ordered with the others rather than
 * exiled to the bottom.
 */
export const UNGROUPED_LABEL = "outside a repo";

/** Group key for {@link UNGROUPED_LABEL}. Empty is not a valid `owner/repo`. */
export const UNGROUPED_KEY = "";

export interface RepoGroup {
  /** `owner/repo`, or {@link UNGROUPED_KEY}. Doubles as the header row's id. */
  key: string;
  label: string;
  sessions: SessionListRow[];
}

/**
 * Newest-activity sort key, as epoch ms rather than the stored string. The two
 * columns are written in different shapes — `startedAt` is a `datetime('now')`
 * default, `endedAt` was ISO until this release — and comparing those as text
 * sorts on the separator (" " before "T") rather than on the time.
 */
export function recencyMs(s: SessionListRow): number {
  return parseDbTime(s.session.endedAt ?? s.session.startedAt);
}

/**
 * Roll sessions up by the repo they ran in, most recently active repo first.
 *
 * `repo` is the rollup axis rather than a checkout path on purpose: a repo's
 * main checkout and every linked worktree hanging off it share one `owner/repo`
 * read from `origin`, so a stack of workspaces on the same project collapses
 * into the one heading a human would draw by hand. `@/lib/session-key` owns the
 * derivation; this only reads the column.
 *
 * Groups are ordered by their freshest session, not alphabetically — the repo
 * you were last working in is the one you almost certainly want, and it should
 * be under the cursor without scrolling. Order *within* a group is whatever the
 * caller handed over, so the launch screen's status-then-recency sort survives.
 *
 * A row whose `repo` is null is bucketed, never dropped: the launch screen is
 * the only way back into a paused session, and hiding one because its cwd was
 * not a repo would strand it.
 */
export function groupByRepo(sessions: SessionListRow[]): RepoGroup[] {
  const byRepo = new Map<string, RepoGroup>();
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

  const freshest = (g: RepoGroup) =>
    g.sessions.reduce((max, s) => Math.max(max, recencyMs(s)), 0);

  return Array.from(byRepo.values()).sort((a, b) => freshest(b) - freshest(a));
}
