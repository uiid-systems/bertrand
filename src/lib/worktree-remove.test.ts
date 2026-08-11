import { describe, test, expect, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { $ } from "bun";
import * as schema from "@/db/schema";
import { _setDb } from "@/db/client";

const TEST_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "bertrand-wtrm-test-")),
  "test.db",
);

const sqlite = new Database(TEST_DB_PATH);
sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec("PRAGMA foreign_keys = ON");

const testDb = drizzle(sqlite, { schema });
_setDb(testDb);

migrate(drizzle(sqlite), {
  migrationsFolder: join(import.meta.dir, "..", "db", "migrations"),
});

const { createCategory } = await import("@/db/queries/categories");
const { createSession, updateSession, updateSessionStatus, getSession } =
  await import("@/db/queries/sessions");
const { getEventsBySession } = await import("@/db/queries/events");
const { getSessionStats } = await import("@/db/queries/stats");
const { snapshotGitDiffStats } = await import("@/lib/stats-snapshot");
const { removeSessionWorktree } = await import("@/lib/worktree-remove");
const { _setServerDeps, _resetServerDeps } = await import(
  "@/lib/workspace/server"
);
const { _setPortDeps, _resetPortDeps } = await import("@/lib/workspace/port");

// Keep teardownWorkspace away from the real workspace state dir and port
// registry; `resolve: () => null` also means no archive script runs.
const isolated = mkdtempSync(join(tmpdir(), "bertrand-wtrm-ws-"));
_setServerDeps({ dir: join(isolated, "state"), resolve: () => null });
_setPortDeps({ registryDir: join(isolated, "ports") });

const dirs: string[] = [isolated];

afterAll(() => {
  _resetServerDeps();
  _resetPortDeps();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function makeRepo(): Promise<string> {
  const repo = mkdtempSync(join(tmpdir(), "bertrand-wtrm-repo-"));
  dirs.push(repo);
  await $`git -C ${repo} init -q -b main`.quiet();
  writeFileSync(join(repo, "README.md"), "hello\n");
  await $`git -C ${repo} -c user.email=test@test -c user.name=test add README.md`.quiet();
  await $`git -C ${repo} -c user.email=test@test -c user.name=test commit -qm init`.quiet();
  return repo;
}

async function addWorktree(repo: string, name: string): Promise<string> {
  const path = join(repo, ".worktrees", name);
  await $`git -C ${repo} worktree add -q ${path} -b ${name}`.quiet();
  return path;
}

const category = createCategory({ slug: "wtrm-test", name: "Worktree Remove" });
let n = 0;

function makeSession(worktreePath: string | null, status: "paused" | "active" = "paused") {
  const slug = `wtrm-${n++}`;
  const s = createSession({ categoryId: category.id, slug, name: slug });
  if (worktreePath) {
    updateSession(s.id, { worktreePath, worktreeBranch: `branch-${slug}` });
  }
  if (status !== "paused") updateSessionStatus(s.id, status);
  return getSession(s.id)!;
}

describe("removeSessionWorktree", () => {
  test("removes the worktree, clears the record, and logs the exit", async () => {
    const repo = await makeRepo();
    const wt = await addWorktree(repo, "feature-a");
    const s = makeSession(wt);

    const result = await removeSessionWorktree(s.id);
    expect(result.ok).toBe(true);

    expect(existsSync(wt)).toBe(false);
    const list = await $`git -C ${repo} worktree list --porcelain`.text();
    expect(list).not.toContain(wt);
    // the branch survives its checkout
    const branches = await $`git -C ${repo} branch --list feature-a`.text();
    expect(branches).toContain("feature-a");

    const after = getSession(s.id)!;
    expect(after.worktreePath).toBeNull();
    expect(after.worktreeBranch).toBeNull();
    const events = getEventsBySession(s.id);
    expect(events.some((e) => e.event === "worktree.exited")).toBe(true);
  });

  test("targets the owning repo even when the process stands elsewhere", async () => {
    // The mirror of worktree-create's #210 guard. `bertrand serve` runs from
    // wherever it was launched, so removal anchored on `process.cwd()` asked
    // the wrong repo to drop a worktree it has never heard of. The decoy is a
    // real repo, not a plain directory: git would refuse an unknown worktree
    // there, which is precisely the failure this asserts cannot happen.
    const repo = await makeRepo();
    const wt = await addWorktree(repo, "feature-afar");
    const s = makeSession(wt);
    const decoy = await makeRepo();

    const originalCwd = process.cwd();
    let result;
    try {
      process.chdir(decoy);
      result = await removeSessionWorktree(s.id);
    } finally {
      process.chdir(originalCwd);
    }

    expect(result.ok).toBe(true);
    expect(existsSync(wt)).toBe(false);
    const list = await $`git -C ${repo} worktree list --porcelain`.text();
    expect(list).not.toContain(wt);
  });

  test("refuses a live session and touches nothing", async () => {
    const repo = await makeRepo();
    const wt = await addWorktree(repo, "feature-live");
    const s = makeSession(wt, "active");

    const result = await removeSessionWorktree(s.id);
    expect(result).toEqual({ ok: false, reason: "active" });
    expect(existsSync(wt)).toBe(true);
    expect(getSession(s.id)!.worktreePath).toBe(wt);
  });

  test("a dirty tree needs force: plain delete says dirty, force succeeds", async () => {
    const repo = await makeRepo();
    const wt = await addWorktree(repo, "feature-dirty");
    writeFileSync(join(wt, "uncommitted.txt"), "wip\n");
    const s = makeSession(wt);

    const plain = await removeSessionWorktree(s.id);
    expect(plain.ok).toBe(false);
    if (!plain.ok) expect(plain.reason).toBe("dirty");
    expect(existsSync(wt)).toBe(true);
    expect(getSession(s.id)!.worktreePath).toBe(wt);

    const forced = await removeSessionWorktree(s.id, { force: true });
    expect(forced.ok).toBe(true);
    expect(existsSync(wt)).toBe(false);
    expect(getSession(s.id)!.worktreePath).toBeNull();
  });

  test("a hand-deleted directory still clears the record", async () => {
    const repo = await makeRepo();
    const wt = await addWorktree(repo, "feature-gone");
    const s = makeSession(wt);
    rmSync(wt, { recursive: true, force: true });

    const result = await removeSessionWorktree(s.id);
    expect(result.ok).toBe(true);
    expect(getSession(s.id)!.worktreePath).toBeNull();
  });

  test("snapshots git-derived stats before the worktree is removed", async () => {
    // The mitigation for the whole git-derived-stats design: once the checkout
    // is gone `git diff` has nothing to read, so a session's real line counts
    // exist only if they were written down first. Removal is the deadline.
    const repo = await makeRepo();
    const wt = await addWorktree(repo, "feature-counted");
    writeFileSync(join(wt, "added.txt"), "one\ntwo\nthree\n");
    await $`git -C ${wt} -c user.email=test@test -c user.name=test add added.txt`.quiet();
    await $`git -C ${wt} -c user.email=test@test -c user.name=test commit -qm work`.quiet();
    const s = makeSession(wt);

    const result = await removeSessionWorktree(s.id);
    expect(result.ok).toBe(true);
    expect(existsSync(wt)).toBe(false);

    // Read back after the worktree is gone — nothing could recompute this now.
    const stats = getSessionStats(s.id)!;
    expect(stats.diffSource).toBe("git");
    expect(stats.linesAdded).toBe(3);
    expect(stats.linesRemoved).toBe(0);
    expect(stats.filesTouched).toBe(1);
  });

  test("a worktree deleted by hand leaves the stored counts alone", async () => {
    // The capture cannot run — there is no directory to measure — so the
    // previous snapshot has to stand rather than being zeroed by an empty
    // answer from git.
    const repo = await makeRepo();
    const wt = await addWorktree(repo, "feature-vanished");
    writeFileSync(join(wt, "added.txt"), "one\ntwo\n");
    await $`git -C ${wt} -c user.email=test@test -c user.name=test add added.txt`.quiet();
    await $`git -C ${wt} -c user.email=test@test -c user.name=test commit -qm work`.quiet();
    const s = makeSession(wt);
    await snapshotGitDiffStats(s);
    expect(getSessionStats(s.id)!.linesAdded).toBe(2);

    rmSync(wt, { recursive: true, force: true });
    const result = await removeSessionWorktree(s.id);

    expect(result.ok).toBe(true);
    const stats = getSessionStats(s.id)!;
    expect(stats.linesAdded).toBe(2);
    expect(stats.filesTouched).toBe(1);
    expect(stats.diffSource).toBe("git");
  });

  test("returns not-found for an unknown session", async () => {
    const result = await removeSessionWorktree("nope");
    expect(result).toEqual({ ok: false, reason: "not-found" });
  });

  test("returns no-worktree for a session without one", async () => {
    const s = makeSession(null);
    const result = await removeSessionWorktree(s.id);
    expect(result).toEqual({ ok: false, reason: "no-worktree" });
  });
});
