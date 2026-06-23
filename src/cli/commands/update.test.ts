import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import * as schema from "@/db/schema";
import { _setDb } from "@/db/client";
import { createCategory } from "@/db/queries/categories";
import { createSession, getSession } from "@/db/queries/sessions";
import { shouldIgnoreStatusFlip, dispatchHookEvent } from "./update";

describe("shouldIgnoreStatusFlip (delayed-hook race guard)", () => {
  test("ignores 'active' flip when pid is null (post-finalize state)", () => {
    expect(shouldIgnoreStatusFlip("active", null)).toBe(true);
  });

  test("ignores 'waiting' flip when pid is null", () => {
    expect(shouldIgnoreStatusFlip("waiting", null)).toBe(true);
  });

  test("allows 'paused' flip when pid is null (legitimate finalize)", () => {
    expect(shouldIgnoreStatusFlip("paused", null)).toBe(false);
  });

  test("allows 'active' flip when pid is set (live session)", () => {
    expect(shouldIgnoreStatusFlip("active", 12345)).toBe(false);
  });

  test("allows 'waiting' flip when pid is set", () => {
    expect(shouldIgnoreStatusFlip("waiting", 12345)).toBe(false);
  });

  test("allows 'archived' flip when pid is null", () => {
    expect(shouldIgnoreStatusFlip("archived", null)).toBe(false);
  });

  test("returns false when newStatus is undefined (no transition implied)", () => {
    expect(shouldIgnoreStatusFlip(undefined, null)).toBe(false);
    expect(shouldIgnoreStatusFlip(undefined, 12345)).toBe(false);
  });
});

// Temp DB so dispatchHookEvent's emit + session-column writes have somewhere to
// land. The override is set at top level, which runs before any test body.
const TEST_DB_PATH = join(mkdtempSync(join(tmpdir(), "bertrand-update-")), "test.db");
const sqlite = new Database(TEST_DB_PATH);
sqlite.exec("PRAGMA foreign_keys = ON");
_setDb(drizzle(sqlite, { schema }));
migrate(drizzle(sqlite), {
  migrationsFolder: join(import.meta.dir, "..", "..", "db", "migrations"),
});

describe("dispatchHookEvent — worktree tracking", () => {
  test("worktree.entered mirrors path + branch onto the session row", () => {
    const cat = createCategory({ slug: "wt-cat", name: "wt" });
    const s = createSession({ categoryId: cat.id, slug: "wt-enter", name: "wt enter" });

    const handled = dispatchHookEvent("worktree.entered", {
      sessionId: s.id,
      meta: { path: "/repo/.claude/worktrees/feat", branch: "worktree-feat" },
    });

    expect(handled).toBe(true);
    const after = getSession(s.id)!;
    expect(after.worktreePath).toBe("/repo/.claude/worktrees/feat");
    expect(after.worktreeBranch).toBe("worktree-feat");
  });

  test("worktree.exited clears the session's worktree state", () => {
    const cat = createCategory({ slug: "wt-cat2", name: "wt2" });
    const s = createSession({ categoryId: cat.id, slug: "wt-exit", name: "wt exit" });

    dispatchHookEvent("worktree.entered", {
      sessionId: s.id,
      meta: { path: "/repo/.claude/worktrees/feat2", branch: "worktree-feat2" },
    });
    dispatchHookEvent("worktree.exited", { sessionId: s.id, meta: {} });

    const after = getSession(s.id)!;
    expect(after.worktreePath).toBeNull();
    expect(after.worktreeBranch).toBeNull();
  });
});
