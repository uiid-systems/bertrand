import { describe, test, expect } from "bun:test";

import type { SessionStatus, SessionListRow } from "../../api/types";
import {
  UNGROUPED_LABEL,
  groupByRepo,
  isLive,
  matchesQuery,
  selectLiveSessions,
  selectSessions,
} from "./sidebar.utils";

const BERTRAND = "uiid-systems/bertrand";
const BACKEND = "Tabs-Platform/tabs-backend";

function stub(
  slug: string,
  status: SessionStatus,
  // Null is the ordinary "ran outside a repo" case, so it's the default: most
  // tests here don't care where a session ran, and the ones that do say so.
  repo: string | null = null,
  updatedAt = "2026-01-01T00:00:00.000Z",
  // Search reads the display name and the branch, so both are overridable;
  // zone A's tests don't care and take the defaults.
  extra: { name?: string; branch?: string | null } = {},
): SessionListRow {
  return {
    session: {
      id: slug,
      slug,
      name: extra.name ?? slug,
      status,
      updatedAt,
      repo,
      branch: extra.branch ?? null,
    } as SessionListRow["session"],
  };
}

const keys = (groups: { key: string }[]) => groups.map((g) => g.key);
const slugs = (sessions: SessionListRow[]) =>
  sessions.map((s) => s.session.slug);

describe("groupByRepo", () => {
  test("buckets rows by repo and names the group after it", () => {
    const groups = groupByRepo([
      stub("a1", "blocked", BACKEND),
      stub("b1", "waiting", BERTRAND),
      stub("a2", "active", BACKEND),
    ]);

    expect(keys(groups)).toEqual([BACKEND, BERTRAND]);
    expect(groups[0]?.label).toBe(BACKEND);
    expect(slugs(groups[0]?.sessions ?? [])).toEqual(["a1", "a2"]);
    expect(slugs(groups[1]?.sessions ?? [])).toEqual(["b1"]);
  });

  test("rolls a repo's worktrees up together whatever branch they're on", () => {
    // The whole reason `repo` is the axis rather than a checkout path: a main
    // checkout and a stack of linked worktrees are one repo, and nobody had to
    // say so.
    const groups = groupByRepo([
      stub("ui-501", "paused", BACKEND, undefined, {
        branch: "feature/ui-501",
      }),
      stub("ui-505", "paused", BACKEND, undefined, {
        branch: "feature/ui-505",
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(slugs(groups[0]?.sessions ?? [])).toEqual(["ui-501", "ui-505"]);
  });

  test("preserves the live priority order it was handed", () => {
    // The whole point of grouping *after* selectLiveSessions: a repo whose only
    // session is merely active must not outrank one holding a session blocked
    // on the user, however recently the active one ran. Re-sorting groups here
    // would invert this.
    const groups = groupByRepo(
      selectLiveSessions([
        stub("b-active", "active", BERTRAND, "2026-01-03T00:00:00.000Z"),
        stub("a-blocked", "blocked", BACKEND, "2026-01-01T00:00:00.000Z"),
      ]),
    );

    expect(keys(groups)).toEqual([BACKEND, BERTRAND]);
  });

  test("group order follows the freshest session when fed a recency sort", () => {
    // How zone B gets "most recently touched repo first" without a second
    // sort: first-seen order over a recency-ordered list *is* that order.
    const groups = groupByRepo(
      selectSessions([
        stub("old", "paused", BACKEND, "2026-01-01T00:00:00.000Z"),
        stub("new", "paused", BERTRAND, "2026-06-01T00:00:00.000Z"),
      ]),
    );

    expect(keys(groups)).toEqual([BERTRAND, BACKEND]);
  });

  test("buckets a repo-less row instead of dropping it", () => {
    // bertrand records sessions in directories that are not repos and must keep
    // doing so — this is an ordinary state, and the zones must never hide a
    // session because of it.
    const groups = groupByRepo([stub("orphan", "active")]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe(UNGROUPED_LABEL);
    expect(slugs(groups[0]?.sessions ?? [])).toEqual(["orphan"]);
  });

  test("keeps the ungrouped bucket separate from a real repo", () => {
    const groups = groupByRepo([
      stub("in-repo", "paused", BERTRAND),
      stub("no-repo", "paused", null),
    ]);

    expect(groups).toHaveLength(2);
    expect(keys(groups)).toEqual([BERTRAND, ""]);
  });
});

describe("matchesQuery", () => {
  const session = stub("fix-search", "paused", BERTRAND, undefined, {
    name: "Fix search",
    branch: "adamfratino/fix-search",
  });

  test("an empty query matches everything", () => {
    expect(matchesQuery(session, "")).toBe(true);
  });

  test("matches on slug and name", () => {
    expect(matchesQuery(session, "fix-")).toBe(true);
    expect(matchesQuery(session, "fix search")).toBe(true);
  });

  test("matches on repo", () => {
    // "everything in bertrand" — the question the deleted project switcher was
    // the only way to ask.
    expect(matchesQuery(session, "uiid-systems")).toBe(true);
  });

  test("matches on branch", () => {
    // The branch is what a unit of work is actually called, so searching for a
    // ticket number has to find the session that worked on it.
    expect(matchesQuery(session, "adamfratino/")).toBe(true);
  });

  test("does not match on unrelated text", () => {
    expect(matchesQuery(session, "terminal")).toBe(false);
  });

  test("a session with no repo or branch still matches on its own name", () => {
    // Null fields must not throw or swallow the row.
    const outside = stub("scratch", "paused", null);
    expect(matchesQuery(outside, "scratch")).toBe(true);
    expect(matchesQuery(outside, "bertrand")).toBe(false);
  });
});

describe("selectSessions", () => {
  test("drops live sessions by default — they're pinned in the live zone", () => {
    const rows = selectSessions([
      stub("paused-one", "paused"),
      stub("running", "active"),
      stub("halted", "blocked"),
      stub("pending", "waiting"),
    ]);

    expect(slugs(rows)).toEqual(["paused-one"]);
  });

  test("includeLive keeps live sessions in the results", () => {
    const rows = selectSessions(
      [stub("paused-one", "paused"), stub("running", "active")],
      { includeLive: true },
    );

    expect(slugs(rows).sort()).toEqual(["paused-one", "running"]);
  });

  test("orders by most recent activity", () => {
    const rows = selectSessions([
      stub("stale", "paused", BERTRAND, "2026-01-01T00:00:00.000Z"),
      stub("fresh", "paused", BERTRAND, "2026-05-01T00:00:00.000Z"),
    ]);

    expect(slugs(rows)).toEqual(["fresh", "stale"]);
  });

  test("returns nothing when nothing is left after filtering", () => {
    expect(selectSessions([])).toEqual([]);
  });
});

describe("searching for a live session", () => {
  // The regression this guards: the live zone ignores the query on purpose, so
  // if the sessions zone also skipped live rows a running session would match
  // nothing anywhere — searching for the session you're sitting in returned an
  // empty list.
  const sessions = [
    stub("fix-search", "active", BERTRAND),
    stub("mv-sidebar-timeline", "paused", BERTRAND),
  ];

  const search = (q: string) =>
    selectSessions(
      sessions.filter((s) => matchesQuery(s, q)),
      { includeLive: q.length > 0 },
    );

  test("finds a live session by name", () => {
    expect(slugs(search("search"))).toEqual(["fix-search"]);
  });

  test("still hides live sessions when no query is active", () => {
    expect(slugs(search(""))).toEqual(["mv-sidebar-timeline"]);
  });
});

describe("selectLiveSessions", () => {
  test("keeps only live statuses, blocked then waiting then active", () => {
    const live = selectLiveSessions([
      stub("running", "active"),
      stub("resting", "paused"),
      stub("pending", "waiting"),
      stub("halted", "blocked"),
      stub("gone", "archived"),
    ]);

    expect(slugs(live)).toEqual(["halted", "pending", "running"]);
  });

  test("orders by most recent activity within a status", () => {
    const live = selectLiveSessions([
      stub("stale", "active", BERTRAND, "2026-01-01T00:00:00.000Z"),
      stub("fresh", "active", BERTRAND, "2026-06-01T00:00:00.000Z"),
    ]);

    expect(slugs(live)).toEqual(["fresh", "stale"]);
  });
});

describe("isLive", () => {
  test("covers exactly the statuses the live zone pins", () => {
    expect(isLive(stub("s", "active"))).toBe(true);
    expect(isLive(stub("s", "waiting"))).toBe(true);
    expect(isLive(stub("s", "blocked"))).toBe(true);
    expect(isLive(stub("s", "paused"))).toBe(false);
    expect(isLive(stub("s", "archived"))).toBe(false);
  });
});
