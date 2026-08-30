import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as schema from "@/db/schema";
import { _setDb } from "@/db/client";

const TEST_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "bertrand-dashboard-resume-test-")),
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
const { createSession, updateSession } = await import("@/db/queries/sessions");
const { createConversation } = await import("@/db/queries/conversations");
const { emitClaudeStarted } = await import("@/db/events/emit");
const { resumeDashboardSession, listDashboardSessions } = await import(
  "./dashboard-session"
);

// A real cap, unlike dashboard-session.test.ts which pins it to 0 to exercise
// the bound. Set per test because bun shares a process across test files.
beforeEach(() => {
  process.env.BERTRAND_MAX_DASHBOARD_SESSIONS = "8";
});

const category = createCategory({ slug: "resume", name: "Resume" });

function makeSession(slug: string) {
  return createSession({ categoryId: category.id, slug, name: slug });
}

/**
 * Every path below stops before `startClaudePty`, so none of them spawn a real
 * `claude`. That is the point: these are the refusals, and each one has to be
 * reachable without a process being created.
 */
describe("resumeDashboardSession refusals", () => {
  test("unknown session is not-found", () => {
    expect(resumeDashboardSession({ sessionId: "nope" })).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(listDashboardSessions()).toEqual([]);
  });

  test("a session that never recorded a cwd is no-cwd, not not-found", () => {
    // It exists — we simply cannot tell where to run it. Conflating the two
    // would tell the user their session is gone when it is sitting right there.
    const s = makeSession("never-started");
    expect(resumeDashboardSession({ sessionId: s.id })).toEqual({
      ok: false,
      reason: "no-cwd",
    });
  });

  test("a session whose recorded cwd no longer exists is no-cwd", () => {
    const gone = mkdtempSync(join(tmpdir(), "bertrand-resume-gone-"));
    const s = makeSession("cwd-deleted");
    const conversationId = crypto.randomUUID();
    createConversation({ id: conversationId, sessionId: s.id });
    emitClaudeStarted({ sessionId: s.id, conversationId, cwd: gone });

    rmSync(gone, { recursive: true, force: true });

    expect(resumeDashboardSession({ sessionId: s.id })).toEqual({
      ok: false,
      reason: "no-cwd",
    });
  });

  test("a conversation from another session is refused", () => {
    const cwd = mkdtempSync(join(tmpdir(), "bertrand-resume-cwd-"));
    const a = makeSession("owner-a");
    const aConversation = crypto.randomUUID();
    createConversation({ id: aConversation, sessionId: a.id });
    emitClaudeStarted({ sessionId: a.id, conversationId: aConversation, cwd });

    const b = makeSession("owner-b");
    const bConversation = crypto.randomUUID();
    createConversation({ id: bConversation, sessionId: b.id });

    expect(
      resumeDashboardSession({
        sessionId: a.id,
        conversationId: bConversation,
      }),
    ).toEqual({ ok: false, reason: "conversation-not-found" });
    expect(listDashboardSessions()).toEqual([]);

    rmSync(cwd, { recursive: true, force: true });
  });

  test("the cwd comes from the most recent claude.started", () => {
    // A session that has already been resumed may have moved; the latest
    // launch is the one that describes where it lives now.
    const older = mkdtempSync(join(tmpdir(), "bertrand-resume-older-"));
    const newer = mkdtempSync(join(tmpdir(), "bertrand-resume-newer-"));
    const s = makeSession("moved");
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    createConversation({ id: first, sessionId: s.id });
    createConversation({ id: second, sessionId: s.id });
    emitClaudeStarted({ sessionId: s.id, conversationId: first, cwd: older });
    emitClaudeStarted({ sessionId: s.id, conversationId: second, cwd: newer });

    // Remove only the newer one. If resolution used the *first* event this
    // would still succeed; because it uses the last, it correctly reports
    // that the directory it would run in is gone.
    rmSync(newer, { recursive: true, force: true });
    expect(resumeDashboardSession({ sessionId: s.id })).toEqual({
      ok: false,
      reason: "no-cwd",
    });

    rmSync(older, { recursive: true, force: true });
  });

  // Legacy `worktree_path` rows (ELKY-163, retired in ELKY-164). Two things
  // wrote that column and they left different records, so the guard compares
  // it against the recorded cwd rather than checking presence.
  test("a row whose worktree disagrees with its recorded cwd is refused", () => {
    // `EnterWorktree` wrote the column mid-run without emitting a fresh
    // `claude.started`, so the event names the main checkout. Resuming there
    // would commit the session's work to whatever branch it has out.
    const mainCheckout = mkdtempSync(join(tmpdir(), "bertrand-resume-main-"));
    const worktree = mkdtempSync(join(tmpdir(), "bertrand-resume-wt-"));
    const s = makeSession("entered-a-worktree");
    const c = crypto.randomUUID();
    createConversation({ id: c, sessionId: s.id });
    emitClaudeStarted({ sessionId: s.id, conversationId: c, cwd: mainCheckout });
    updateSession(s.id, { worktreePath: worktree, worktreeBranch: "wt-legacy" });

    expect(resumeDashboardSession({ sessionId: s.id })).toEqual({
      ok: false,
      reason: "worktree-gone",
    });
    expect(listDashboardSessions()).toEqual([]);

    rmSync(mainCheckout, { recursive: true, force: true });
    rmSync(worktree, { recursive: true, force: true });
  });

  test("a row whose recorded cwd is already the worktree is allowed through", () => {
    // A dashboard spawn (#210) started `claude` *in* the worktree, so the event
    // names it and the row needs no special handling. Refusing on presence
    // alone would turn these away for nothing.
    //
    // Proven by the refusal it gets *instead*: `conversation-not-found` comes
    // from `planResume`, which only runs once the cwd resolved. Asserting that
    // keeps this a refusal test — a genuinely successful resume would spawn.
    const worktree = mkdtempSync(join(tmpdir(), "bertrand-resume-spawned-"));
    const s = makeSession("spawned-in-a-worktree");
    const c = crypto.randomUUID();
    createConversation({ id: c, sessionId: s.id });
    emitClaudeStarted({ sessionId: s.id, conversationId: c, cwd: worktree });
    updateSession(s.id, { worktreePath: worktree, worktreeBranch: "wt-spawned" });

    expect(
      resumeDashboardSession({
        sessionId: s.id,
        conversationId: crypto.randomUUID(),
      }),
    ).toEqual({ ok: false, reason: "conversation-not-found" });
    expect(listDashboardSessions()).toEqual([]);

    rmSync(worktree, { recursive: true, force: true });
  });
});
