import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { $ } from "bun";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import * as schema from "@/db/schema";
import { _setDb } from "@/db/client";
import { _resetRepoCache } from "@/lib/github/resolve";

/**
 * Exercised against real `git`, not a fake runner, because the behaviour under
 * test is git's: that a linked worktree reports its own root from
 * `--show-toplevel` while still sharing `--git-common-dir` with the main
 * checkout, and that both therefore resolve to one repo identity. A stubbed
 * runner would only re-assert what the stub was told.
 */
const WORK = realpathSync(mkdtempSync(join(tmpdir(), "bertrand-key-")));
const sqlite = new Database(join(WORK, "test.db"));
sqlite.exec("PRAGMA foreign_keys = ON");
_setDb(drizzle(sqlite, { schema }));
migrate(drizzle(sqlite), {
  migrationsFolder: join(import.meta.dir, "..", "db", "migrations"),
});

const { createSession, getSession } = await import("@/db/queries/sessions");
const { recordSessionKey, sessionKeyColumns } = await import("./session-record");
const { deriveSessionKey } = await import("./session-key");

const repo = join(WORK, "repo");
const linked = join(WORK, "linked");

let n = 0;
const newSession = () => createSession({ slug: `key-test-${++n}` }).id;

beforeAll(async () => {
  await $`mkdir -p ${repo}`.quiet();
  await $`git -C ${repo} init -q -b trunk`.quiet();
  await $`git -C ${repo} config user.email t@example.com`.quiet();
  await $`git -C ${repo} config user.name Test`.quiet();
  await $`git -C ${repo} remote add origin git@github.com:acme/widgets.git`.quiet();
  writeFileSync(join(repo, "a.txt"), "hello\n");
  await $`git -C ${repo} add -A`.quiet();
  await $`git -C ${repo} commit -qm init`.quiet();
  // The case this whole change exists for: a task in its own worktree.
  await $`git -C ${repo} worktree add -q -b feature/x ${linked}`.quiet();
});

afterAll(() => rmSync(WORK, { recursive: true, force: true }));

describe("recordSessionKey", () => {
  test("writes the whole key from a main checkout", async () => {
    const id = newSession();
    expect(getSession(id)?.groupKey).toBeNull();

    await recordSessionKey(id, repo);

    const row = getSession(id)!;
    expect(row.branch).toBe("trunk");
    expect(row.repo).toBe("acme/widgets");
    expect(row.groupKey).toBe("acme/widgets@trunk");
    expect(realpathSync(row.worktreeRoot!)).toBe(repo);
  });

  test("a linked worktree gets its own root but the same repo identity", async () => {
    const main = newSession();
    const task = newSession();
    await recordSessionKey(main, repo);
    await recordSessionKey(task, linked);

    const a = getSession(main)!;
    const b = getSession(task)!;

    // Same repo — this is what makes the two roll up together in the sidebar
    // without anyone registering a binding.
    expect(b.repo).toBe(a.repo);
    // Different unit of work — this is what stops them sharing a session.
    expect(b.groupKey).toBe("acme/widgets@feature/x");
    expect(b.groupKey).not.toBe(a.groupKey);
    expect(realpathSync(b.worktreeRoot!)).toBe(linked);
    // `--git-common-dir` points a linked worktree at the main checkout.
    expect(realpathSync(b.mainCheckout!)).toBe(repo);
  });

  test("two sessions in one worktree share a group key", async () => {
    const first = newSession();
    const second = newSession();
    await recordSessionKey(first, linked);
    await recordSessionKey(second, linked);

    expect(getSession(second)!.groupKey).toBe(getSession(first)!.groupKey);
  });

  test("a cwd outside any repo records nulls rather than refusing", async () => {
    const id = newSession();
    await recordSessionKey(id, WORK);

    const row = getSession(id)!;
    expect(row.groupKey).toBeNull();
    expect(row.repo).toBeNull();
    expect(row.branch).toBeNull();
    expect(row.worktreeRoot).toBeNull();
  });

  test("a cwd that does not exist records nulls rather than throwing", async () => {
    const id = newSession();
    await recordSessionKey(id, join(WORK, "gone"));
    expect(getSession(id)!.groupKey).toBeNull();
  });

  test("re-recording follows a session that moved", async () => {
    const id = newSession();
    await recordSessionKey(id, repo);
    expect(getSession(id)!.groupKey).toBe("acme/widgets@trunk");

    // A resume that lands in the task worktree instead.
    _resetRepoCache();
    await recordSessionKey(id, linked);

    const row = getSession(id)!;
    expect(row.groupKey).toBe("acme/widgets@feature/x");
    expect(row.branch).toBe("feature/x");
  });
});

describe("sessionKeyColumns", () => {
  test("covers every column a key write must touch", async () => {
    const columns = sessionKeyColumns(await deriveSessionKey(linked));
    // Named explicitly: a key write that set four of these would leave the row
    // self-contradictory, so the set itself is the invariant worth pinning.
    expect(Object.keys(columns).sort()).toEqual([
      "branch",
      "groupKey",
      "mainCheckout",
      "repo",
      "worktreeRoot",
    ]);
  });

  test("keeps branch and groupKey agreeing with each other", async () => {
    const columns = sessionKeyColumns(await deriveSessionKey(linked));
    expect(columns.groupKey).toBe(`${columns.repo}@${columns.branch}`);
  });
});
