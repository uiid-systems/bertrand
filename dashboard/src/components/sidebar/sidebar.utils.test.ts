import { describe, test, expect } from "bun:test";

import type { SessionStatus, SessionWithCategory } from "../../api/types";
import { groupByProject, selectLiveSessions } from "./sidebar.utils";

const acme = { slug: "acme", name: "Acme" };
const beta = { slug: "beta", name: "Beta" };

function stub(
  slug: string,
  status: SessionStatus,
  project?: { slug: string; name: string },
  updatedAt = "2026-01-01T00:00:00.000Z",
): SessionWithCategory {
  return {
    categoryPath: "cat",
    project,
    session: {
      id: slug,
      slug,
      status,
      updatedAt,
    } as SessionWithCategory["session"],
  };
}

const keys = (groups: { key: string }[]) => groups.map((g) => g.key);
const slugs = (sessions: SessionWithCategory[]) =>
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
