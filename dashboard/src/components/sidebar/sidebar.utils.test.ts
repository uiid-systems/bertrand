import { describe, test, expect } from "bun:test";

import type { SessionStatus, SessionListRow } from "../../api/types";
import {
  groupByProject,
  isLive,
  matchesQuery,
  selectLiveSessions,
  selectProjectSessions,
} from "./sidebar.utils";

const acme = { slug: "acme", name: "Acme" };
const beta = { slug: "beta", name: "Beta" };

function stub(
  slug: string,
  status: SessionStatus,
  project?: { slug: string; name: string },
  updatedAt = "2026-01-01T00:00:00.000Z",
  // Search reads the display name, so it's overridable; zone A's tests don't
  // care and take the default.
  extra: { name?: string } = {},
): SessionListRow {
  return {
    project,
    session: {
      id: slug,
      slug,
      name: extra.name ?? slug,
      status,
      updatedAt,
    } as SessionListRow["session"],
  };
}

const keys = (groups: { key: string }[]) => groups.map((g) => g.key);
const slugs = (sessions: SessionListRow[]) =>
  sessions.map((s) => s.session.slug);

describe("groupByProject", () => {
  test("buckets rows by project and names the group after it", () => {
    const groups = groupByProject([
      stub("a1", "blocked", acme),
      stub("b1", "waiting", beta),
      stub("a2", "active", acme),
    ]);

    expect(keys(groups)).toEqual(["acme", "beta"]);
    expect(groups[0]?.label).toBe("Acme");
    expect(slugs(groups[0]?.sessions ?? [])).toEqual(["a1", "a2"]);
    expect(slugs(groups[1]?.sessions ?? [])).toEqual(["b1"]);
  });

  test("preserves the live priority order it was handed", () => {
    // The whole point of grouping *after* selectLiveSessions: a project whose
    // only session is merely active must not outrank one holding a session
    // blocked on the user, however recently the active one ran. Re-sorting
    // groups by recency here would invert this.
    const groups = groupByProject(
      selectLiveSessions([
        stub("b-active", "active", beta, "2026-01-03T00:00:00.000Z"),
        stub("a-blocked", "blocked", acme, "2026-01-01T00:00:00.000Z"),
      ]),
    );

    expect(keys(groups)).toEqual(["acme", "beta"]);
  });

  test("buckets a project-less row instead of dropping it", () => {
    // The live zone is a pinned inbox — nothing may silently disappear from it
    // just because its query didn't carry a project.
    const groups = groupByProject([stub("orphan", "active")]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("Unknown project");
    expect(slugs(groups[0]?.sessions ?? [])).toEqual(["orphan"]);
  });
});

describe("matchesQuery", () => {
  const session = stub("fix-search", "paused", acme, undefined, {
    name: "Fix search",
  });

  test("an empty query matches everything", () => {
    expect(matchesQuery(session, "")).toBe(true);
  });

  test("matches on slug and name", () => {
    expect(matchesQuery(session, "fix-")).toBe(true);
    expect(matchesQuery(session, "fix search")).toBe(true);
  });

  test("does not match on unrelated text", () => {
    expect(matchesQuery(session, "terminal")).toBe(false);
  });

  test("the project name is not matchable", () => {
    // Search only ever narrows one project, so every row shares its name —
    // matching it would return the whole list for a query that looks specific.
    expect(matchesQuery(session, "acme")).toBe(false);
  });
});

describe("selectProjectSessions", () => {
  test("drops live sessions by default — they're pinned in the live zone", () => {
    const rows = selectProjectSessions([
      stub("paused-one", "paused"),
      stub("running", "active"),
      stub("halted", "blocked"),
      stub("pending", "waiting"),
    ]);

    expect(slugs(rows)).toEqual(["paused-one"]);
  });

  test("includeLive keeps live sessions in the results", () => {
    const rows = selectProjectSessions(
      [stub("paused-one", "paused"), stub("running", "active")],
      { includeLive: true },
    );

    expect(slugs(rows).sort()).toEqual(["paused-one", "running"]);
  });

  test("orders by most recent activity", () => {
    const rows = selectProjectSessions([
      stub("stale", "paused", acme, "2026-01-01T00:00:00.000Z"),
      stub("fresh", "paused", acme, "2026-05-01T00:00:00.000Z"),
    ]);

    expect(slugs(rows)).toEqual(["fresh", "stale"]);
  });

  test("returns nothing when nothing is left after filtering", () => {
    expect(selectProjectSessions([])).toEqual([]);
  });
});

describe("searching for a live session", () => {
  // The regression this guards: the live zone ignores the query on purpose, so
  // if the project zone also skipped live rows a running session would match
  // nothing anywhere — searching for the session you're sitting in returned an
  // empty list.
  const sessions = [
    stub("fix-search", "active", acme),
    stub("mv-sidebar-timeline", "paused", acme),
  ];

  const search = (q: string) =>
    selectProjectSessions(
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
      stub("stale", "active", acme, "2026-01-01T00:00:00.000Z"),
      stub("fresh", "active", acme, "2026-06-01T00:00:00.000Z"),
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
