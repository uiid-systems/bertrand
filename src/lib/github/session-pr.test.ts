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
  branch: "feature-branch",
  repoPath: "/tmp/repo",
  ...over,
});

describe("resolveSessionPullRequest", () => {
  test("looks the PR up by the branch on the session row", async () => {
    const d = deps();
    const result = await resolveSessionPullRequest(source(), d);

    expect(result).toEqual({ status: "ok", pullRequest: PR });
    expect(d.asked.branches).toEqual(["feature-branch"]);
  });

  test("resolves identity from the project's bound checkout", async () => {
    const d = deps();
    await resolveSessionPullRequest(source(), d);

    expect(d.asked.paths).toEqual(["/tmp/repo"]);
  });

  // This is every session today: nothing writes a branch since the worktree
  // teardown, so the card is uniformly dark until ELKY-177 records one. The
  // point of the assertion is that it costs nothing — no repo resolution, no
  // `gh` call — rather than merely rendering empty.
  test("reports no PR, and asks nothing, when there is no branch", async () => {
    const d = deps();
    const result = await resolveSessionPullRequest(source({ branch: null }), d);

    expect(result).toEqual({ status: "none" });
    expect(d.asked.paths).toEqual([]);
    expect(d.asked.branches).toEqual([]);
  });

  test("treats a blank branch as no branch", async () => {
    const d = deps();
    const result = await resolveSessionPullRequest(source({ branch: "   " }), d);

    expect(result).toEqual({ status: "none" });
    expect(d.asked.branches).toEqual([]);
  });

  test("reports no PR when the project has no bound checkout", async () => {
    const d = deps();
    const result = await resolveSessionPullRequest(
      source({ repoPath: undefined }),
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
