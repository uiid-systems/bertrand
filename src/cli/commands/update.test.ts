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
import { createSession } from "@/db/queries/sessions";
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

describe("dispatchHookEvent — retired worktree events", () => {
  // Regression guard for the worktree teardown (ELKY-163). These two event
  // types were the writers for `worktree_path` / `worktree_branch`: the
  // EnterWorktree and ExitWorktree hooks shelled `bertrand update` with them
  // mid-session. Nothing emits them now, and the dispatcher no longer claims
  // them — a stale hook still installed in someone's settings.json gets a
  // clean "not handled" rather than silently writing columns that are on
  // their way out (ELKY-164).
  //
  // Historical rows are untouched: `catalog.ts` still renders both types so
  // old timelines read correctly.
  test("worktree.entered is no longer handled", () => {
    const cat = createCategory({ slug: "wt-cat", name: "wt" });
    const s = createSession({ categoryId: cat.id, slug: "wt-enter", name: "wt enter" });

    const handled = dispatchHookEvent("worktree.entered", {
      sessionId: s.id,
      meta: { path: "/repo/.claude/worktrees/feat", branch: "worktree-feat" },
    });

    expect(handled).toBe(false);
  });

  test("worktree.exited is no longer handled", () => {
    const cat = createCategory({ slug: "wt-cat2", name: "wt2" });
    const s = createSession({ categoryId: cat.id, slug: "wt-exit", name: "wt exit" });

    expect(dispatchHookEvent("worktree.exited", { sessionId: s.id, meta: {} })).toBe(
      false,
    );
  });
});
