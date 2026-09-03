import { describe, test, expect, beforeEach } from "bun:test";

const {
  DashboardSessionLimitError,
  dashboardSessionLimit,
  spawnDashboardSession,
  resumeDashboardSession,
  listDashboardSessions,
} = await import("./dashboard-session");

// Zero means *every* start is over the cap, which exercises the guard without
// launching a real `claude` — the check runs before any process or row exists,
// and before the cwd is derived, so these tests need neither a database nor a
// git checkout. They used to need a project registry as well: spawning read
// the repo off the active project's binding, which is what made "which
// directory?" a lookup instead of an argument.
//
// Set per test rather than once at module load: bun shares a process across
// test files, and a sibling file needs a different cap. Whoever loaded first
// used to win.
beforeEach(() => {
  process.env.BERTRAND_MAX_DASHBOARD_SESSIONS = "0";
});

describe("dashboard session concurrency bound", () => {
  test("reads the cap from the environment", () => {
    expect(dashboardSessionLimit()).toBe(0);
  });

  test("re-reads the cap rather than snapshotting it", () => {
    process.env.BERTRAND_MAX_DASHBOARD_SESSIONS = "3";
    expect(dashboardSessionLimit()).toBe(3);
  });

  test("refuses to spawn past the cap", async () => {
    await expect(
      spawnDashboardSession({ slug: "over-cap" }),
    ).rejects.toThrow(DashboardSessionLimitError);
  });

  test("the refused spawn registers no session", async () => {
    // The guard runs before the cwd is derived and before createSession, so a
    // rejection leaves no trace — no half-built row for recovery to clean up
    // later, and nothing shelled out to git for.
    try {
      await spawnDashboardSession({ slug: "over-cap-2" });
    } catch {
      // expected
    }
    expect(listDashboardSessions()).toEqual([]);
  });

  test("a slugless spawn is accepted by validation — it reaches the cap check", async () => {
    // The cap error (not a slug complaint) proves the missing slug passed
    // argument handling; the placeholder is only issued after the guards.
    process.env.BERTRAND_MAX_DASHBOARD_SESSIONS = "0";
    await expect(spawnDashboardSession({})).rejects.toThrow(
      DashboardSessionLimitError,
    );
  });

  test("the error names the limit it enforced", () => {
    const err = new DashboardSessionLimitError(8);
    expect(err.limit).toBe(8);
    expect(err.message).toContain("8");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("resume under the same bound (#214)", () => {
  // A resumed session costs exactly what a new one does, so it has to answer
  // to the same cap. Returned rather than thrown: at capacity is a condition
  // the user can act on, and the HTTP layer maps it to 503 with the remedy.
  test("refuses to resume past the cap, without touching the session", () => {
    const result = resumeDashboardSession({ sessionId: "any-session" });
    expect(result).toEqual({ ok: false, reason: "at-capacity", limit: 0 });
  });

  test("the refused resume registers no session", () => {
    resumeDashboardSession({ sessionId: "any-session" });
    expect(listDashboardSessions()).toEqual([]);
  });

  test("capacity is checked before the session is even looked up", () => {
    // An unknown id still reports at-capacity, which is the honest answer:
    // nothing could have been started regardless of whether it existed.
    expect(resumeDashboardSession({ sessionId: "definitely-not-real" })).toMatchObject(
      { reason: "at-capacity" },
    );
  });
});
