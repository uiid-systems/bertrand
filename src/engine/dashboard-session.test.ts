import { describe, test, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  _setRegistryDir,
  _getRegistryDir,
  writeRegistry,
} from "@/lib/projects/registry";
import { _resetActiveProjectCache } from "@/lib/projects/resolve";
import { UnboundProjectError } from "@/lib/projects/policy";

const {
  DashboardSessionLimitError,
  WorktreeCreateError,
  dashboardSessionLimit,
  spawnDashboardSession,
  resumeDashboardSession,
  listDashboardSessions,
} = await import("./dashboard-session");

const TS = "2026-01-01T00:00:00.000Z";
const originalRegistryDir = _getRegistryDir();
const originalProjectEnv = process.env.BERTRAND_PROJECT;

const temps: string[] = [];
function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  temps.push(dir);
  return dir;
}

/**
 * Point the process at a project that either has a repo binding or doesn't.
 *
 * Spawning now reads the repo off the active project, so every spawn test needs
 * a registry to read — and `BERTRAND_PROJECT` has to be pinned explicitly,
 * because bertrand sets it in its own sessions and an inherited value would
 * silently outrank the registry we just wrote.
 */
function useProject(slug: string, repoPath?: string): void {
  writeRegistry({
    activeProjectSlug: slug,
    projects: [
      {
        slug,
        name: slug,
        createdAt: TS,
        lastUsedAt: TS,
        ...(repoPath
          ? {
              repo: {
                path: repoPath,
                provider: { provider: "github" as const, owner: "acme", repo: slug },
              },
            }
          : {}),
      },
    ],
  });
  process.env.BERTRAND_PROJECT = slug;
  _resetActiveProjectCache();
}

// Zero means *every* start is over the cap, which exercises the guard without
// launching a real `claude` — the check runs before any process or row exists.
//
// Set per test rather than once at module load: bun shares a process across
// test files, and a sibling file needs a different cap. Whoever loaded first
// used to win.
beforeEach(() => {
  process.env.BERTRAND_MAX_DASHBOARD_SESSIONS = "0";
  _setRegistryDir(tempDir("bertrand-registry-"));
});

afterEach(() => {
  _setRegistryDir(originalRegistryDir);
  if (originalProjectEnv === undefined) delete process.env.BERTRAND_PROJECT;
  else process.env.BERTRAND_PROJECT = originalProjectEnv;
  _resetActiveProjectCache();
});

afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
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
    useProject("capped", process.cwd());
    await expect(
      spawnDashboardSession({ categoryPath: "test", slug: "over-cap" }),
    ).rejects.toThrow(DashboardSessionLimitError);
  });

  test("the refused spawn registers no session", async () => {
    // The guard runs before both worktree creation and createSession, so a
    // rejection leaves no trace — no half-built row for recovery to clean up
    // later, and no orphaned worktree on disk.
    useProject("capped", process.cwd());
    try {
      await spawnDashboardSession({ categoryPath: "test", slug: "over-cap-2" });
    } catch {
      // expected
    }
    expect(listDashboardSessions()).toEqual([]);
  });

  test("a project bound to a non-repo is refused before any session exists", async () => {
    // Raised past the guard so the spawn actually reaches worktree creation —
    // the point being that the *next* gate also runs before createSession.
    process.env.BERTRAND_MAX_DASHBOARD_SESSIONS = "5";
    useProject("bad-binding", tempDir("bertrand-spawn-"));

    await expect(
      spawnDashboardSession({ categoryPath: "test", slug: "no-repo-here" }),
    ).rejects.toThrow(WorktreeCreateError);
    expect(listDashboardSessions()).toEqual([]);
  });

  test("the refusal names the reason so the API can map it", async () => {
    process.env.BERTRAND_MAX_DASHBOARD_SESSIONS = "5";
    useProject("bad-binding", tempDir("bertrand-spawn-"));

    const err = await spawnDashboardSession({
      categoryPath: "test",
      slug: "no-repo-either",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(WorktreeCreateError);
    expect(err.reason).toBe("not-a-repo");
  });

  test("the error names the limit it enforced", () => {
    const err = new DashboardSessionLimitError(8);
    expect(err.limit).toBe(8);
    expect(err.message).toContain("8");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("the repo is derived from the project, not supplied", () => {
  test("an unbound project cannot start a session at all", async () => {
    process.env.BERTRAND_MAX_DASHBOARD_SESSIONS = "5";
    useProject("unlinked");

    // Asserted by catching rather than `rejects.toThrow`, so the *type* is
    // checked outright — the HTTP layer branches on it to return 409.
    const err = await spawnDashboardSession({
      categoryPath: "test",
      slug: "nowhere-to-run",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(UnboundProjectError);
    expect(listDashboardSessions()).toEqual([]);
  });

  test("the refusal names the project and the command that fixes it", async () => {
    process.env.BERTRAND_MAX_DASHBOARD_SESSIONS = "5";
    useProject("unlinked");

    const err = await spawnDashboardSession({
      categoryPath: "test",
      slug: "nowhere-to-run-2",
    }).catch((e) => e);

    expect(err.slug).toBe("unlinked");
    expect(err.message).toContain("bertrand project link unlinked");
  });

  test("an unbound project is reported even when the server is at capacity", async () => {
    // Capacity is transient and the binding is not. Someone told "too many
    // sessions" when the real problem is an unlinked project would go stop a
    // session and hit the same wall, so the permanent fault wins.
    process.env.BERTRAND_MAX_DASHBOARD_SESSIONS = "0";
    useProject("unlinked");

    const err = await spawnDashboardSession({
      categoryPath: "test",
      slug: "capped-and-unbound",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(UnboundProjectError);
    expect(err).not.toBeInstanceOf(DashboardSessionLimitError);
  });

  test("the bound repo is what the worktree is cut from", async () => {
    // The binding is the only path input, so a binding that is not a repo has
    // to surface as `not-a-repo` against *that* path — proof the resolver read
    // the project rather than falling back to the server's own cwd, which is a
    // real repo and would have succeeded.
    process.env.BERTRAND_MAX_DASHBOARD_SESSIONS = "5";
    const bound = tempDir("bertrand-bound-");
    useProject("points-at-junk", bound);

    const err = await spawnDashboardSession({
      categoryPath: "test",
      slug: "derives-from-binding",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(WorktreeCreateError);
    expect(err.reason).toBe("not-a-repo");
    expect(err.message).toContain(bound);
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
