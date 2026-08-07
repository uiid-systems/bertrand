import { describe, test, expect } from "bun:test";

// Read at module load, so it must be set before the import below. Zero means
// *every* spawn is over the cap, which exercises the guard without starting a
// real `claude` — the check runs before any process or row is created.
process.env.BERTRAND_MAX_DASHBOARD_SESSIONS = "0";

const {
  DashboardSessionLimitError,
  MAX_DASHBOARD_SESSIONS,
  spawnDashboardSession,
  listDashboardSessions,
} = await import("./dashboard-session");

describe("dashboard session concurrency bound", () => {
  test("reads the cap from the environment", () => {
    expect(MAX_DASHBOARD_SESSIONS).toBe(0);
  });

  test("refuses to spawn past the cap", () => {
    expect(() =>
      spawnDashboardSession({
        categoryPath: "test",
        slug: "over-cap",
        cwd: process.cwd(),
      }),
    ).toThrow(DashboardSessionLimitError);
  });

  test("the refused spawn registers no session", () => {
    // The guard runs before createSession, so a rejection leaves no trace —
    // no half-built row for recovery to clean up later.
    try {
      spawnDashboardSession({
        categoryPath: "test",
        slug: "over-cap-2",
        cwd: process.cwd(),
      });
    } catch {
      // expected
    }
    expect(listDashboardSessions()).toEqual([]);
  });

  test("the error names the limit it enforced", () => {
    const err = new DashboardSessionLimitError(8);
    expect(err.limit).toBe(8);
    expect(err.message).toContain("8");
    expect(err).toBeInstanceOf(Error);
  });
});
