import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { $ } from "bun";

import {
  resolveRepoAt,
  _resetRepoCache,
  _setGitRunner,
  _setClock,
  type GitRunner,
} from "./resolve";

/** The exact commands the resolver issues, in the order it issues them. */
const WORKTREE_LIST = "worktree list --porcelain";
const ORIGIN_URL = "config --get remote.origin.url";
const ORIGIN_HEAD = "symbolic-ref --short refs/remotes/origin/HEAD";

const REPO = "/repo";

type Responses = Record<string, string | Error>;

interface FakeGit {
  runner: GitRunner;
  /** One entry per subprocess the resolver would have spawned. */
  calls: { cwd: string; command: string }[];
}

/**
 * A git that answers from a table. Every response is delayed by a microtask so
 * concurrent callers genuinely overlap — a synchronous fake would coalesce even
 * without the in-flight map and prove nothing.
 */
function fakeGit(responses: Responses): FakeGit {
  const calls: FakeGit["calls"] = [];

  const runner: GitRunner = async (cwd, args) => {
    const command = args.join(" ");
    calls.push({ cwd, command });

    await Promise.resolve();

    const response = responses[command];

    if (response === undefined) {
      throw new Error(`unstubbed git command: ${command}`);
    }
    if (response instanceof Error) {
      throw response;
    }

    return response;
  };

  return { runner, calls };
}

/** A repo whose origin is a GitHub remote with `origin/HEAD` set. */
function githubRepo(overrides: Responses = {}): Responses {
  return {
    [WORKTREE_LIST]: `worktree ${REPO}\nHEAD abc123\nbranch refs/heads/main\n`,
    [ORIGIN_URL]: "git@github.com:uiid-systems/bertrand.git",
    [ORIGIN_HEAD]: "origin/main",
    ...overrides,
  };
}

/** `git` exits non-zero for a missing key or an unset ref. */
const gitFailure = () => new Error("exited with code 1");

let clock = 0;

beforeEach(() => {
  clock = 1_000_000;
  _setClock(() => clock);
  _resetRepoCache();
});

afterEach(() => {
  _setGitRunner(null);
  _setClock(null);
  _resetRepoCache();
});

describe("resolveRepoAt", () => {
  test("resolves identity, root, and default branch", async () => {
    const git = fakeGit(githubRepo());
    _setGitRunner(git.runner);

    const result = await resolveRepoAt(REPO);

    expect(result).toEqual({
      ok: true,
      repo: {
        path: REPO,
        provider: { provider: "github", owner: "uiid-systems", repo: "bertrand" },
        defaultBranch: "main",
      },
    });
  });

  test("returns the main worktree, not the path it was asked about", async () => {
    // `git worktree list` reports the main checkout first even when run from a
    // linked worktree — the binding must outlive that worktree.
    const git = fakeGit(
      githubRepo({
        [WORKTREE_LIST]: `worktree ${REPO}\nHEAD abc\nbranch refs/heads/main\n\nworktree /wt/feature\nHEAD def\nbranch refs/heads/feature\n`,
      }),
    );
    _setGitRunner(git.runner);

    const result = await resolveRepoAt("/wt/feature");

    expect(result.ok).toBe(true);
    expect(result.ok && result.repo.path).toBe(REPO);
  });

  test("reads origin and origin/HEAD from the resolved root", async () => {
    const git = fakeGit(githubRepo());
    _setGitRunner(git.runner);

    await resolveRepoAt("/repo/src/lib");

    expect(git.calls).toEqual([
      { cwd: "/repo/src/lib", command: WORKTREE_LIST },
      { cwd: REPO, command: ORIGIN_URL },
      { cwd: REPO, command: ORIGIN_HEAD },
    ]);
  });

  test("omits defaultBranch when origin/HEAD is unset", async () => {
    const git = fakeGit(githubRepo({ [ORIGIN_HEAD]: gitFailure() }));
    _setGitRunner(git.runner);

    const result = await resolveRepoAt(REPO);

    expect(result.ok).toBe(true);
    expect(result.ok && "defaultBranch" in result.repo).toBe(false);
  });

  test("omits defaultBranch when origin/HEAD is blank", async () => {
    const git = fakeGit(githubRepo({ [ORIGIN_HEAD]: "" }));
    _setGitRunner(git.runner);

    const result = await resolveRepoAt(REPO);

    expect(result.ok).toBe(true);
    expect(result.ok && "defaultBranch" in result.repo).toBe(false);
  });

  test("keeps a default branch that is not origin-prefixed", async () => {
    const git = fakeGit(githubRepo({ [ORIGIN_HEAD]: "main" }));
    _setGitRunner(git.runner);

    const result = await resolveRepoAt(REPO);

    expect(result.ok && result.repo.defaultBranch).toBe("main");
  });

  test("carries the enterprise host through from the remote", async () => {
    const git = fakeGit(githubRepo({ [ORIGIN_URL]: "git@github.acme.com:o/r.git" }));
    _setGitRunner(git.runner);

    const result = await resolveRepoAt(REPO);

    expect(result.ok && result.repo.provider).toEqual({
      provider: "github",
      owner: "o",
      repo: "r",
      host: "github.acme.com",
    });
  });
});

describe("resolveRepoAt failures", () => {
  test("not-a-repo when git rejects", async () => {
    const git = fakeGit({ [WORKTREE_LIST]: gitFailure() });
    _setGitRunner(git.runner);

    expect(await resolveRepoAt("/not/a/repo")).toEqual({ ok: false, reason: "not-a-repo" });
  });

  test("not-a-repo stops before touching the remote", async () => {
    const git = fakeGit({ [WORKTREE_LIST]: gitFailure() });
    _setGitRunner(git.runner);

    await resolveRepoAt("/not/a/repo");

    expect(git.calls).toHaveLength(1);
  });

  test("not-a-repo when the listing has no worktree line", async () => {
    const git = fakeGit({ [WORKTREE_LIST]: "" });
    _setGitRunner(git.runner);

    expect(await resolveRepoAt(REPO)).toEqual({ ok: false, reason: "not-a-repo" });
  });

  test("no-remote when origin is unset", async () => {
    const git = fakeGit(githubRepo({ [ORIGIN_URL]: gitFailure() }));
    _setGitRunner(git.runner);

    expect(await resolveRepoAt(REPO)).toEqual({ ok: false, reason: "no-remote" });
  });

  test("no-remote when origin is set but blank", async () => {
    const git = fakeGit(githubRepo({ [ORIGIN_URL]: "" }));
    _setGitRunner(git.runner);

    expect(await resolveRepoAt(REPO)).toEqual({ ok: false, reason: "no-remote" });
  });

  test("not-github carries the offending remote", async () => {
    const remote = "git@gitlab.com:o/r.git";
    const git = fakeGit(githubRepo({ [ORIGIN_URL]: remote }));
    _setGitRunner(git.runner);

    expect(await resolveRepoAt(REPO)).toEqual({
      ok: false,
      reason: "not-github",
      remoteUrl: remote,
    });
  });

  test("not-github stops before resolving a default branch", async () => {
    const git = fakeGit(githubRepo({ [ORIGIN_URL]: "git@gitlab.com:o/r.git" }));
    _setGitRunner(git.runner);

    await resolveRepoAt(REPO);

    expect(git.calls.map((c) => c.command)).toEqual([WORKTREE_LIST, ORIGIN_URL]);
  });
});

describe("resolveRepoAt caching", () => {
  test("coalesces concurrent calls into one resolution", async () => {
    const git = fakeGit(githubRepo());
    _setGitRunner(git.runner);

    const results = await Promise.all(
      Array.from({ length: 25 }, () => resolveRepoAt(REPO)),
    );

    // One resolution's worth of subprocesses, not 25.
    expect(git.calls).toHaveLength(3);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  test("coalesced callers all receive the same result", async () => {
    const git = fakeGit(githubRepo());
    _setGitRunner(git.runner);

    const [a, b] = await Promise.all([resolveRepoAt(REPO), resolveRepoAt(REPO)]);

    expect(a).toEqual(b);
  });

  test("coalesces concurrent failures too", async () => {
    const git = fakeGit({ [WORKTREE_LIST]: gitFailure() });
    _setGitRunner(git.runner);

    await Promise.all(Array.from({ length: 10 }, () => resolveRepoAt(REPO)));

    expect(git.calls).toHaveLength(1);
  });

  test("serves a repeat call from cache without spawning git", async () => {
    const git = fakeGit(githubRepo());
    _setGitRunner(git.runner);

    await resolveRepoAt(REPO);
    const before = git.calls.length;
    await resolveRepoAt(REPO);

    expect(git.calls).toHaveLength(before);
  });

  test("normalizes the path, so a relative call hits the same entry", async () => {
    const git = fakeGit(githubRepo());
    _setGitRunner(git.runner);

    await resolveRepoAt(process.cwd());
    const before = git.calls.length;
    await resolveRepoAt(".");

    expect(git.calls).toHaveLength(before);
  });

  test("re-resolves a positive result after 30s", async () => {
    const git = fakeGit(githubRepo());
    _setGitRunner(git.runner);

    await resolveRepoAt(REPO);
    clock += 30_001;
    await resolveRepoAt(REPO);

    expect(git.calls).toHaveLength(6);
  });

  test("holds a positive result just under 30s", async () => {
    const git = fakeGit(githubRepo());
    _setGitRunner(git.runner);

    await resolveRepoAt(REPO);
    clock += 29_999;
    await resolveRepoAt(REPO);

    expect(git.calls).toHaveLength(3);
  });

  test("holds a failure past the positive TTL", async () => {
    const git = fakeGit({ [WORKTREE_LIST]: gitFailure() });
    _setGitRunner(git.runner);

    await resolveRepoAt(REPO);
    clock += 60_000;
    await resolveRepoAt(REPO);

    expect(git.calls).toHaveLength(1);
  });

  test("re-resolves a failure after 5min", async () => {
    const git = fakeGit({ [WORKTREE_LIST]: gitFailure() });
    _setGitRunner(git.runner);

    await resolveRepoAt(REPO);
    clock += 300_001;
    await resolveRepoAt(REPO);

    expect(git.calls).toHaveLength(2);
  });

  test("picks up a remote that changed after the TTL lapsed", async () => {
    const responses = githubRepo();
    const git = fakeGit(responses);
    _setGitRunner(git.runner);

    await resolveRepoAt(REPO);
    responses[ORIGIN_URL] = "git@github.com:other/fork.git";
    clock += 30_001;
    const result = await resolveRepoAt(REPO);

    expect(result.ok && result.repo.provider.repo).toBe("fork");
  });

  test("_resetRepoCache forces the next call to re-resolve", async () => {
    const git = fakeGit(githubRepo());
    _setGitRunner(git.runner);

    await resolveRepoAt(REPO);
    _resetRepoCache();
    await resolveRepoAt(REPO);

    expect(git.calls).toHaveLength(6);
  });

  test("caches each path separately", async () => {
    const git = fakeGit(githubRepo());
    _setGitRunner(git.runner);

    await resolveRepoAt(REPO);
    await resolveRepoAt("/other/repo");

    expect(git.calls).toHaveLength(6);
  });
});

/**
 * The fake proves the caching and branching; these prove the real runner —
 * that the commands are spelled correctly and parse against actual git output.
 * A temp repo keeps it deterministic rather than depending on this checkout.
 */
describe("resolveRepoAt against real git", () => {
  let root: string;

  beforeEach(async () => {
    // macOS `$TMPDIR` is a symlink and git reports the resolved path.
    root = realpathSync(mkdtempSync(join(tmpdir(), "bertrand-resolve-")));

    await $`git -C ${root} init -q`.quiet();
    await $`git -C ${root} remote add origin https://github.com/uiid-systems/bertrand.git`.quiet();
    await $`git -C ${root} symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main`.quiet();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("resolves a real checkout", async () => {
    const result = await resolveRepoAt(root);

    expect(result).toEqual({
      ok: true,
      repo: {
        path: root,
        provider: { provider: "github", owner: "uiid-systems", repo: "bertrand" },
        defaultBranch: "main",
      },
    });
  });

  test("resolves the root from a subdirectory", async () => {
    const nested = join(root, "src", "lib");
    mkdirSync(nested, { recursive: true });

    const result = await resolveRepoAt(nested);

    expect(result.ok && result.repo.path).toBe(root);
  });

  test("returns not-a-repo for a directory outside any repo", async () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "bertrand-no-repo-")));

    try {
      expect(await resolveRepoAt(outside)).toEqual({ ok: false, reason: "not-a-repo" });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("returns no-remote for a repo without an origin", async () => {
    await $`git -C ${root} remote remove origin`.quiet();
    _resetRepoCache();

    expect(await resolveRepoAt(root)).toEqual({ ok: false, reason: "no-remote" });
  });
});
