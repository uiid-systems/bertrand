import { describe, test, expect } from "bun:test";

import type { SessionListRow } from "@/types";
import { UNGROUPED_KEY, UNGROUPED_LABEL, groupByRepo } from "./group";

/**
 * The launch screen is the only way back into a paused session, so what this
 * guards is coverage as much as ordering: every session handed in has to come
 * out under exactly one heading, including the ones whose cwd was not a repo.
 */

const BACKEND = "Tabs-Platform/tabs-backend";
const BERTRAND = "uiid-systems/bertrand";

function stub(
  slug: string,
  repo: string | null,
  branch: string | null,
  // sqlite `datetime('now')` shape, which is what the column actually holds —
  // `recencyMs` exists because comparing these as text sorts on the separator.
  startedAt = "2026-09-03 12:00:00",
): SessionListRow {
  return {
    session: {
      id: slug,
      slug,
      name: slug,
      status: "paused",
      repo,
      branch,
      groupKey: repo && branch ? `${repo}@${branch}` : null,
      startedAt,
      endedAt: null,
    } as SessionListRow["session"],
  };
}

const keys = (groups: { key: string }[]) => groups.map((g) => g.key);
const slugs = (g: { sessions: SessionListRow[] } | undefined) =>
  (g?.sessions ?? []).map((s) => s.session.slug);

describe("groupByRepo", () => {
  test("rolls the current cohort up into one heading per repo", () => {
    // The eight sessions this refactor was measured against: five worktrees of
    // one backend repo plus three checkouts of bertrand. The old model filed
    // five of them under the wrong project; `repo` is read from `origin`, so
    // there is nothing left to file wrong.
    const groups = groupByRepo([
      stub("ui-501", BACKEND, "feature/ui-501", "2026-09-02 09:00:00"),
      stub("ui-502", BACKEND, "feature/ui-502", "2026-09-02 10:00:00"),
      stub("ui-505", BACKEND, "feature/ui-505", "2026-09-02 11:00:00"),
      stub("ui-549", BACKEND, "feature/ui-549", "2026-09-02 12:00:00"),
      stub("ui-555", BACKEND, "feature/ui-555", "2026-09-02 13:00:00"),
      stub("main", BERTRAND, "main", "2026-09-03 08:00:00"),
      stub("cleanup", BERTRAND, "adamfratino/clean-up-session-grouping", "2026-09-03 14:00:00"),
      stub("ratings", BERTRAND, "adamfratino/remove-ratings", "2026-09-03 09:00:00"),
    ]);

    expect(keys(groups)).toEqual([BERTRAND, BACKEND]);
    expect(slugs(groups[0])).toEqual(["main", "cleanup", "ratings"]);
    expect(slugs(groups[1])).toEqual([
      "ui-501",
      "ui-502",
      "ui-505",
      "ui-549",
      "ui-555",
    ]);
  });

  test("orders groups by their freshest session, not alphabetically", () => {
    // The repo you were last in should be a keypress away, not wherever the
    // alphabet puts it.
    const groups = groupByRepo([
      stub("old", BACKEND, "feature/ui-501", "2026-01-01 00:00:00"),
      stub("new", BERTRAND, "main", "2026-09-03 00:00:00"),
    ]);

    expect(keys(groups)).toEqual([BERTRAND, BACKEND]);
  });

  test("preserves the order it was handed inside a group", () => {
    // The screen sorts status-then-recency before grouping; re-sorting here
    // would drop a waiting session below an older paused one.
    const groups = groupByRepo([
      stub("second", BACKEND, "feature/ui-502", "2026-09-01 00:00:00"),
      stub("first", BACKEND, "feature/ui-501", "2026-09-02 00:00:00"),
    ]);

    expect(slugs(groups[0])).toEqual(["second", "first"]);
  });

  test("buckets a session with no repo rather than dropping it", () => {
    const groups = groupByRepo([stub("scratch", null, null)]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe(UNGROUPED_KEY);
    expect(groups[0]?.label).toBe(UNGROUPED_LABEL);
    expect(slugs(groups[0])).toEqual(["scratch"]);
  });

  test("keeps a repo-less session out of a real repo's group", () => {
    const groups = groupByRepo([
      stub("in-repo", BERTRAND, "main", "2026-09-03 00:00:00"),
      stub("no-repo", null, null, "2026-09-01 00:00:00"),
    ]);

    expect(keys(groups)).toEqual([BERTRAND, UNGROUPED_KEY]);
  });

  test("groups a repo with an unrecorded branch under that repo anyway", () => {
    // A detached HEAD has no branch but still has an `origin`, so it rolls up
    // normally — the branch is what the row displays, not what buckets it.
    const groups = groupByRepo([stub("detached", BERTRAND, null)]);

    expect(keys(groups)).toEqual([BERTRAND]);
  });

  test("returns nothing for an empty list", () => {
    expect(groupByRepo([])).toEqual([]);
  });
});
