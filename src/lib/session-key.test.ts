import { afterEach, describe, expect, test } from "bun:test";
import { _resetRepoCache, _setGitRunner as _setResolveRunner } from "@/lib/github/resolve";
import { _setGitRunner, deriveSessionKey, groupKey } from "@/lib/session-key";

/**
 * A fake git. `answers` is keyed by the joined argv, so a case declares only
 * the lookups it cares about and anything else throws — which is exactly how
 * git behaves outside a repo, and the path every null in `SessionKey` takes.
 */
function fakeGit(answers: Record<string, string>) {
  return async (_cwd: string, args: string[]) => {
    const key = args.join(" ");
    const answer = answers[key];
    if (answer === undefined) throw new Error(`fatal: no answer for: git ${key}`);
    return answer;
  };
}

const REPO = {
  "rev-parse --show-toplevel": "/w/orca/task-1",
  "rev-parse --git-common-dir": "/w/main/.git",
  "rev-parse --abbrev-ref HEAD": "feature/x",
  // `resolveRepoAt`'s own lookups: it finds the main worktree from
  // `worktree list` and reads origin via `config --get`, not `remote get-url`.
  "worktree list --porcelain": "worktree /w/main\nHEAD abc\nbranch refs/heads/main",
  "config --get remote.origin.url": "git@github.com:acme/widgets.git",
  "symbolic-ref --short refs/remotes/origin/HEAD": "origin/main",
};

function useGit(answers: Record<string, string>) {
  _setGitRunner(fakeGit(answers));
  _setResolveRunner(fakeGit(answers));
  _resetRepoCache();
}

afterEach(() => {
  _setGitRunner(null);
  _setResolveRunner(null);
  _resetRepoCache();
});

describe("deriveSessionKey", () => {
  test("a linked worktree keeps its own root and names the main checkout", async () => {
    useGit(REPO);
    const key = await deriveSessionKey("/w/orca/task-1");
    expect(key.worktreeRoot).toBe("/w/orca/task-1");
    expect(key.mainCheckout).toBe("/w/main");
    expect(key.branch).toBe("feature/x");
    expect(key.repo).toBe("acme/widgets");
  });

  test("in the main checkout, worktree root and main checkout coincide", async () => {
    useGit({
      ...REPO,
      "rev-parse --show-toplevel": "/w/main",
      // What git actually answers when cwd *is* the main checkout: a relative
      // `.git`, which has to be resolved before the suffix can be stripped.
      "rev-parse --git-common-dir": ".git",
      "rev-parse --abbrev-ref HEAD": "main",
    });
    const key = await deriveSessionKey("/w/main");
    expect(key.worktreeRoot).toBe("/w/main");
    expect(key.mainCheckout).toBe("/w/main");
    expect(groupKey(key)).toBe("acme/widgets@main");
  });

  test("a cwd outside any repo yields all nulls rather than throwing", async () => {
    useGit({});
    expect(await deriveSessionKey("/tmp/nowhere")).toEqual({
      worktreeRoot: null,
      mainCheckout: null,
      branch: null,
      repo: null,
    });
  });

  test("a detached HEAD records no branch, not the literal 'HEAD'", async () => {
    useGit({ ...REPO, "rev-parse --abbrev-ref HEAD": "HEAD" });
    const key = await deriveSessionKey("/w/orca/task-1");
    expect(key.branch).toBeNull();
    // Still groups — by path, because the worktree is the task even when the
    // branch pointer is gone.
    expect(groupKey(key)).toBe("path:/w/orca/task-1");
  });

  test("a repo with no parseable origin still resolves its worktree", async () => {
    const { "config --get remote.origin.url": _origin, ...noOrigin } = REPO;
    useGit(noOrigin);
    const key = await deriveSessionKey("/w/orca/task-1");
    expect(key.repo).toBeNull();
    expect(key.branch).toBe("feature/x");
    expect(key.worktreeRoot).toBe("/w/orca/task-1");
  });

  test("a bare repo names no main checkout", async () => {
    useGit({ ...REPO, "rev-parse --git-common-dir": "/w/bare.git" });
    expect((await deriveSessionKey("/w/orca/task-1")).mainCheckout).toBeNull();
  });
});

describe("groupKey", () => {
  const key = (over: Partial<Awaited<ReturnType<typeof deriveSessionKey>>> = {}) => ({
    worktreeRoot: "/w/orca/task-1",
    mainCheckout: "/w/main",
    branch: "feature/x",
    repo: "acme/widgets",
    ...over,
  });

  test("prefers (repo, branch), so the group outlives its worktree", () => {
    expect(groupKey(key())).toBe("acme/widgets@feature/x");
    // Same task resumed from the main checkout after the worktree was deleted.
    expect(groupKey(key({ worktreeRoot: "/w/main", mainCheckout: "/w/main" }))).toBe(
      "acme/widgets@feature/x",
    );
  });

  test("two branches in one repo are two groups", () => {
    expect(groupKey(key({ branch: "main" }))).not.toBe(groupKey(key()));
  });

  test("one branch name in two repos is two groups", () => {
    expect(groupKey(key({ repo: "acme/other" }))).not.toBe(groupKey(key()));
  });

  test("falls back to the worktree path, namespaced so it cannot collide", () => {
    expect(groupKey(key({ repo: null }))).toBe("path:/w/orca/task-1");
    expect(groupKey(key({ branch: null }))).toBe("path:/w/orca/task-1");
  });

  test("null only when there is genuinely nothing to group by", () => {
    expect(
      groupKey({ worktreeRoot: null, mainCheckout: null, branch: null, repo: null }),
    ).toBeNull();
  });
});
