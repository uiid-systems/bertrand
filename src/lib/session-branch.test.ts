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

const WORK = realpathSync(mkdtempSync(join(tmpdir(), "bertrand-branch-")));
const sqlite = new Database(join(WORK, "test.db"));
sqlite.exec("PRAGMA foreign_keys = ON");
_setDb(drizzle(sqlite, { schema }));
migrate(drizzle(sqlite), {
  migrationsFolder: join(import.meta.dir, "..", "db", "migrations"),
});

const { createCategory } = await import("@/db/queries/categories");
const { createSession, getSession } = await import("@/db/queries/sessions");
const { recordSessionBranch } = await import("./session-branch");

const repo = join(WORK, "repo");
let categoryId: string;
let n = 0;
const newSession = () => {
  const s = createSession({
    categoryId,
    slug: `branch-test-${++n}`,
    name: `branch test ${n}`,
  });
  return s.id;
};

beforeAll(async () => {
  categoryId = createCategory({ slug: "branch-cat", name: "branch" }).id;
  await $`mkdir -p ${repo}`.quiet();
  await $`git -C ${repo} init -q -b trunk`.quiet();
  await $`git -C ${repo} config user.email t@example.com`.quiet();
  await $`git -C ${repo} config user.name Test`.quiet();
  writeFileSync(join(repo, "a.txt"), "hello\n");
  await $`git -C ${repo} add -A`.quiet();
  await $`git -C ${repo} commit -qm init`.quiet();
});

afterAll(() => rmSync(WORK, { recursive: true, force: true }));

describe("recordSessionBranch", () => {
  test("writes the cwd's current branch onto the session row", async () => {
    const id = newSession();
    expect(getSession(id)?.branch).toBeNull();

    const branch = await recordSessionBranch(id, repo);

    expect(branch).toBe("trunk");
    expect(getSession(id)?.branch).toBe("trunk");
  });

  test("re-recording on resume overwrites with the branch that is out now", async () => {
    const id = newSession();
    await recordSessionBranch(id, repo);
    expect(getSession(id)?.branch).toBe("trunk");

    await $`git -C ${repo} checkout -q -b second-branch`.quiet();
    await recordSessionBranch(id, repo);

    expect(getSession(id)?.branch).toBe("second-branch");
    await $`git -C ${repo} checkout -q trunk`.quiet();
  });

  test("a session started outside a repo records null, without throwing", async () => {
    const id = newSession();
    const loose = join(WORK, "loose");
    await $`mkdir -p ${loose}`.quiet();

    const branch = await recordSessionBranch(id, loose);

    expect(branch).toBeNull();
    expect(getSession(id)?.branch).toBeNull();
  });

  test("a cwd that no longer exists records null rather than failing the start", async () => {
    const id = newSession();
    const branch = await recordSessionBranch(id, join(WORK, "gone"));
    expect(branch).toBeNull();
    expect(getSession(id)?.branch).toBeNull();
  });
});
