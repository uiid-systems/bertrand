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

  test("a recorded worktree that is gone refuses rather than falling back", () => {
    // The precedence guard. Both records are present and they disagree: the
    // worktree is gone, the recorded cwd is fine. Treating the worktree as a
    // mere fallback would resolve to that recorded cwd — which for a session
    // that entered a worktree mid-run is the main checkout it was cut from,
    // resuming isolated work on `main`. The refusal is the point.
    const checkout = mkdtempSync(join(tmpdir(), "bertrand-resume-checkout-"));
    const worktree = mkdtempSync(join(tmpdir(), "bertrand-resume-wt-"));
    const s = makeSession("worktree-deleted");
    const conversationId = crypto.randomUUID();
    createConversation({ id: conversationId, sessionId: s.id });
    emitClaudeStarted({ sessionId: s.id, conversationId, cwd: checkout });
    updateSession(s.id, { worktreePath: worktree, worktreeBranch: "feature" });

    rmSync(worktree, { recursive: true, force: true });

    expect(resumeDashboardSession({ sessionId: s.id })).toEqual({
      ok: false,
      reason: "worktree-gone",
    });

    rmSync(checkout, { recursive: true, force: true });
  });

  test("a live worktree resolves the cwd with no launch ever recorded", () => {
    // The other half of precedence: the worktree is consulted at all. This
    // session has no `claude.started`, so it would be `no-cwd` if resolution
    // only read events. Reaching `conversation-not-found` — a refusal raised
    // *after* the cwd is settled — is what proves the worktree answered.
    const worktree = mkdtempSync(join(tmpdir(), "bertrand-resume-wt-live-"));
    const s = makeSession("worktree-only");
    updateSession(s.id, { worktreePath: worktree, worktreeBranch: "feature" });

    const foreign = makeSession("worktree-only-other");
    const foreignConversation = crypto.randomUUID();
    createConversation({ id: foreignConversation, sessionId: foreign.id });

    expect(
      resumeDashboardSession({
        sessionId: s.id,
        conversationId: foreignConversation,
      }),
    ).toEqual({ ok: false, reason: "conversation-not-found" });
    expect(listDashboardSessions()).toEqual([]);

    rmSync(worktree, { recursive: true, force: true });
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
});
