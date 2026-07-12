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
