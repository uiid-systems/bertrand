import { describe, test, expect, afterAll } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { $ } from "bun";
import {
  WORKTREES_DIR,
  createSessionWorktree,
  resolveWorktreeTarget,
} from "@/lib/worktree-create";

const temps: string[] = [];

/** A real repo with one commit — `git worktree add` needs a HEAD to branch from. */
async function makeRepo(): Promise<string> {
  // realpath because macOS hands out /var/folders symlinks while git reports
  // the resolved /private/var path, and these tests compare the two.
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "bertrand-wtc-")));
  temps.push(repo);
  await $`git -C ${repo} init -q -b main`.quiet();
  writeFileSync(join(repo, "README.md"), "hi\n");
  await $`git -C ${repo} -c user.email=test@test -c user.name=test add README.md`.quiet();
  await $`git -C ${repo} -c user.email=test@test -c user.name=test commit -qm init`.quiet();
  return repo;
}

function makePlainDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "bertrand-wtc-plain-")));
  temps.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

describe("resolveWorktreeTarget", () => {
  test("places the worktree under the repo's main checkout", async () => {
    const repo = await makeRepo();
    const result = await resolveWorktreeTarget(repo, "my-feature");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.target.root).toBe(repo);
    expect(result.target.path).toBe(join(repo, WORKTREES_DIR, "my-feature"));
    expect(result.target.branch).toBe("my-feature");
  });

  test("a directory that is not a git repo is refused, not adopted", async () => {
    // The whole point of the explicit check: getMainWorktree would happily
    // return this path as a "root" and git would create a worktree in it.
    const result = await resolveWorktreeTarget(makePlainDir(), "whatever");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not-a-repo");
  });

  test("a path that does not exist is refused", async () => {
    const result = await resolveWorktreeTarget("/nope/not/here", "whatever");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not-a-repo");
  });

  test("an occupied path reports path-exists", async () => {
    const repo = await makeRepo();
    mkdirSync(join(repo, WORKTREES_DIR, "taken"), { recursive: true });
    const result = await resolveWorktreeTarget(repo, "taken");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("path-exists");
  });

  test("an existing branch reports branch-exists", async () => {
    const repo = await makeRepo();
    await $`git -C ${repo} branch already-there`.quiet();
    const result = await resolveWorktreeTarget(repo, "already-there");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("branch-exists");
  });

  test("resolving from inside a worktree still anchors on the main checkout", async () => {
    const repo = await makeRepo();
    const first = await createSessionWorktree(repo, "first");
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Called with the *worktree* as cwd — the second worktree must still land
    // under the repo root rather than nesting inside its sibling.
    const second = await resolveWorktreeTarget(first.target.path, "second");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.target.root).toBe(repo);
    expect(second.target.path).toBe(join(repo, WORKTREES_DIR, "second"));
  });
});

describe("createSessionWorktree", () => {
  test("creates the worktree on a branch named for the slug", async () => {
    const repo = await makeRepo();
    const result = await createSessionWorktree(repo, "feat-a");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(existsSync(result.target.path)).toBe(true);

    const list = await $`git -C ${repo} worktree list --porcelain`.text();
    expect(list).toContain(result.target.path);

    const branches = await $`git -C ${repo} branch --list feat-a`.text();
    expect(branches.trim()).not.toBe("");
  });

  test("targets the given repo even when the process stands elsewhere", async () => {
    // This is issue #210's actual defect: the old bare `git worktree add` ran
    // in the calling process's inherited cwd, so from `bertrand serve` it
    // created worktrees relative to wherever serve was launched.
    const repo = await makeRepo();
    const elsewhere = makePlainDir();
    const originalCwd = process.cwd();
    try {
      process.chdir(elsewhere);
      const result = await createSessionWorktree(repo, "from-afar");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.target.path.startsWith(repo)).toBe(true);
      expect(existsSync(join(repo, WORKTREES_DIR, "from-afar"))).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }

    // Nothing was written into the directory the process happened to be in.
    expect(existsSync(join(elsewhere, WORKTREES_DIR))).toBe(false);
  });

  test("branches from an explicit base when one is given", async () => {
    const repo = await makeRepo();
    await $`git -C ${repo} branch base-line`.quiet();
    const result = await createSessionWorktree(repo, "off-base", {
      baseBranch: "base-line",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(existsSync(result.target.path)).toBe(true);
  });

  test("a collision is reported without creating anything", async () => {
    const repo = await makeRepo();
    await $`git -C ${repo} branch clash`.quiet();
    const result = await createSessionWorktree(repo, "clash");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("branch-exists");
    expect(existsSync(join(repo, WORKTREES_DIR, "clash"))).toBe(false);
  });
});
