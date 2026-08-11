import { describe, expect, test } from "bun:test";

import {
  resolveSessionPullRequest,
  type SessionPrDeps,
  type SessionPrSource,
} from "./session-pr";
import type { PullRequest } from "./types";

const IDENTITY = {
  provider: "github",
  owner: "uiid-systems",
  repo: "bertrand",
} as const;

const PR: PullRequest = {
  number: 256,
  state: "OPEN",
  isDraft: false,
  title: "feat(dashboard): PR status",
  url: "https://github.com/uiid-systems/bertrand/pull/256",
  mergeable: "MERGEABLE",
  headRefName: "elky-156",
  checks: [],
  rollup: "none",
};

/**
 * Deps that answer successfully for everything, plus a record of what they
 * were asked. Tests override the one call they're about, so a change in an
 * unrelated arm shows up as a failure here rather than passing silently.
 */
function deps(overrides: Partial<SessionPrDeps> = {}): SessionPrDeps & {
  asked: { branches: string[]; paths: string[] };
} {
  const asked = { branches: [] as string[], paths: [] as string[] };
  return {
    asked,
    readBranch: async () => "live-branch",
    resolveRepo: async (path) => {
      asked.paths.push(path);
      return { ok: true, repo: { path, provider: IDENTITY } };
    },
    lookupPR: async (_identity, branch) => {
      asked.branches.push(branch);
      return { ok: true, value: PR };
    },
    ...overrides,
  };
}

const source = (over: Partial<SessionPrSource> = {}): SessionPrSource => ({
  worktreePath: "/tmp/wt",
  worktreeBranch: "snapshot-branch",
  repoPath: "/tmp/repo",
  ...over,
});

describe("resolveSessionPullRequest", () => {
  test("looks the PR up by the branch git currently reports", async () => {
    const d = deps();
    const result = await resolveSessionPullRequest(source(), d);

    expect(result).toEqual({ status: "ok", pullRequest: PR });
    // Not `snapshot-branch`: the DB column is an EnterWorktree-time snapshot,
    // so a session that switched branches would get the wrong PR.
    expect(d.asked.branches).toEqual(["live-branch"]);
  });

  test("falls back to the DB snapshot when git can't name a branch", async () => {
    const d = deps({ readBranch: async () => null });
    await resolveSessionPullRequest(source(), d);

    expect(d.asked.branches).toEqual(["snapshot-branch"]);
  });

  test("uses the snapshot and the project repo once the worktree is gone", async () => {
    const d = deps({
      readBranch: async () => {
        throw new Error("must not read a worktree that isn't there");
      },
    });
    const result = await resolveSessionPullRequest(
      source({ worktreePath: null }),
      d,
    );

    expect(result).toEqual({ status: "ok", pullRequest: PR });
    expect(d.asked.branches).toEqual(["snapshot-branch"]);
    expect(d.asked.paths).toEqual(["/tmp/repo"]);
  });

  test("resolves identity from the worktree when it exists", async () => {
    const d = deps();
    await resolveSessionPullRequest(source(), d);

    expect(d.asked.paths).toEqual(["/tmp/wt"]);
  });

  test("reports no PR, and asks nothing, when there is no branch at all", async () => {
    const d = deps({ readBranch: async () => null });
    const result = await resolveSessionPullRequest(
      source({ worktreePath: null, worktreeBranch: null }),
      d,
    );

    expect(result).toEqual({ status: "none" });
    expect(d.asked.paths).toEqual([]);
    expect(d.asked.branches).toEqual([]);
  });

  test("treats a blank branch as no branch", async () => {
    const d = deps({ readBranch: async () => "   " });
    const result = await resolveSessionPullRequest(
      source({ worktreeBranch: "" }),
      d,
    );

    expect(result).toEqual({ status: "none" });
    expect(d.asked.branches).toEqual([]);
  });

  test("reports no PR when the session has no path to resolve a repo from", async () => {
    const d = deps();
    const result = await resolveSessionPullRequest(
      source({ worktreePath: null, repoPath: undefined }),
      d,
    );

    expect(result).toEqual({ status: "none" });
    expect(d.asked.paths).toEqual([]);
  });

  // A repo bertrand cannot bind is a permanent fact about the project, not an
  // outage. Reporting it as `unavailable` would put an unknown state on every
  // session in a non-GitHub project, forever — the scaffolding this avoids.
  for (const reason of ["not-a-repo", "no-remote", "not-github"] as const) {
    test(`reports no PR — not unavailable — for a ${reason} checkout`, async () => {
      const d = deps({ resolveRepo: async () => ({ ok: false, reason }) });
      const result = await resolveSessionPullRequest(source(), d);

      expect(result).toEqual({ status: "none" });
      expect(d.asked.branches).toEqual([]);
    });
  }

  test("passes a gh failure through as unavailable, carrying the reason", async () => {
    const d = deps({
      lookupPR: async () => ({
        ok: false,
        reason: "rate-limited",
        message: "GitHub API rate limit exceeded.",
      }),
    });
    const result = await resolveSessionPullRequest(source(), d);

    expect(result).toEqual({
      status: "unavailable",
      reason: "rate-limited",
      message: "GitHub API rate limit exceeded.",
    });
  });

  test("reports no PR when the branch simply has none", async () => {
    const d = deps({ lookupPR: async () => ({ ok: true, value: null }) });

    expect(await resolveSessionPullRequest(source(), d)).toEqual({
      status: "none",
    });
  });
});
