import { describe, test, expect, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import * as schema from "@/db/schema";
import { _setDb } from "@/db/client";

const TEST_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "bertrand-resume-plan-test-")),
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
const { createSession } = await import("@/db/queries/sessions");
const { createConversation, getConversationsBySession, discardConversation } =
  await import("@/db/queries/conversations");
const { planResume, newConversation, resolveSessionName } = await import(
  "@/engine/resume-plan"
);
const { claudeTranscriptPath } = await import("@/lib/transcript");

const category = createCategory({ slug: "resume-test", name: "Resume Test" });

function makeSession(slug: string) {
  return createSession({ categoryId: category.id, slug, name: slug });
}

/**
 * Plant a transcript where Claude would keep one for `conversationId` when run
 * from `cwd`, so `claudeSessionExists` finds it. This is the only thing that
 * distinguishes `--resume` from `--session-id`.
 *
 * `claudeTranscriptPath` resolves under the real `~/.claude/projects`, and
 * there is no seam to redirect it, so every directory created here is recorded
 * and removed in afterAll. The cwds are one-off paths under the system temp
 * dir, so the derived slugs cannot collide with a real project's.
 */
const plantedDirs = new Set<string>();

function plantTranscript(conversationId: string, cwd: string) {
  const path = claudeTranscriptPath(conversationId, cwd);
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, "");
  plantedDirs.add(dir);
  return path;
}

afterAll(() => {
  for (const dir of plantedDirs) {
    // Guard the removal against ever pointing somewhere real: these are always
    // the tmpdir-derived slugs planted above.
    if (dir.includes("-bertrand-resume-")) rmSync(dir, { recursive: true, force: true });
  }
});

const CWD = "/tmp/bertrand-resume-plan-cwd";

describe("planResume", () => {
  test("returns not-found for an unknown session", () => {
    expect(planResume({ sessionId: "nope", cwd: CWD })).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  test("mints a new conversation when none is given", () => {
    const s = makeSession("plan-new");
    expect(getConversationsBySession(s.id)).toHaveLength(0);

    const result = planResume({ sessionId: s.id, cwd: CWD });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = getConversationsBySession(s.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(result.plan.conversationId);
    // Claude has never seen a UUID minted a moment ago.
    expect(result.plan.resumeExisting).toBe(false);
  });

  test("reuses the conversation it is given", () => {
    const s = makeSession("plan-existing");
    const id = crypto.randomUUID();
    createConversation({ id, sessionId: s.id });

    const result = planResume({ sessionId: s.id, conversationId: id, cwd: CWD });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.conversationId).toBe(id);
    // No extra conversation row was created.
    expect(getConversationsBySession(s.id)).toHaveLength(1);
  });

  test("refuses a conversation belonging to another session", () => {
    const a = makeSession("plan-owner-a");
    const b = makeSession("plan-owner-b");
    const bConversation = crypto.randomUUID();
    createConversation({ id: bConversation, sessionId: b.id });

    // Resuming A under B's conversation would attach B's transcript to A's
    // event stream.
    expect(
      planResume({ sessionId: a.id, conversationId: bConversation, cwd: CWD }),
    ).toEqual({ ok: false, reason: "conversation-not-found" });
  });

  test("refuses a discarded conversation", () => {
    const s = makeSession("plan-discarded");
    const id = crypto.randomUUID();
    createConversation({ id, sessionId: s.id });
    discardConversation(id);

    expect(planResume({ sessionId: s.id, conversationId: id, cwd: CWD })).toEqual(
      { ok: false, reason: "conversation-not-found" },
    );
  });

  test("resumeExisting is true only when a transcript exists for that cwd", () => {
    const s = makeSession("plan-transcript");
    const id = crypto.randomUUID();
    createConversation({ id, sessionId: s.id });

    const cwd = join(tmpdir(), `bertrand-resume-${Date.now()}`);

    const before = planResume({ sessionId: s.id, conversationId: id, cwd });
    expect(before.ok && before.plan.resumeExisting).toBe(false);

    plantTranscript(id, cwd);

    const after = planResume({ sessionId: s.id, conversationId: id, cwd });
    expect(after.ok && after.plan.resumeExisting).toBe(true);
  });

  test("cwd decides the answer — the same conversation differs by directory", () => {
    // This is the whole reason cwd is a required parameter. Claude keys a
    // transcript by working directory, so asking from the server's cwd (which
    // has no relation to the session) would always miss and silently downgrade
    // every resume to a blank --session-id run.
    const s = makeSession("plan-cwd-scoped");
    const id = crypto.randomUUID();
    createConversation({ id, sessionId: s.id });

    const right = join(tmpdir(), `bertrand-resume-right-${Date.now()}`);
    const wrong = join(tmpdir(), `bertrand-resume-wrong-${Date.now()}`);
    plantTranscript(id, right);

    const fromRight = planResume({ sessionId: s.id, conversationId: id, cwd: right });
    const fromWrong = planResume({ sessionId: s.id, conversationId: id, cwd: wrong });

    expect(fromRight.ok && fromRight.plan.resumeExisting).toBe(true);
    expect(fromWrong.ok && fromWrong.plan.resumeExisting).toBe(false);
  });

  test("carries the canonical session name and a contract mentioning it", () => {
    const s = makeSession("plan-naming");
    const result = planResume({ sessionId: s.id, cwd: CWD });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.sessionName).toBe("resume-test/plan-naming");
    expect(result.plan.contract).toContain("resume-test/plan-naming");
  });
});

describe("newConversation", () => {
  test("creates a conversation owned by the session", () => {
    const s = makeSession("new-conv");
    const id = newConversation(s.id);
    const rows = getConversationsBySession(s.id);
    expect(rows.map((r) => r.id)).toContain(id);
  });
});

describe("resolveSessionName", () => {
  test("uses category path and slug", () => {
    const s = makeSession("naming-1");
    expect(resolveSessionName(s)).toBe("resume-test/naming-1");
  });

  test("falls back to the stored name when the category is missing", () => {
    const s = makeSession("naming-2");
    expect(resolveSessionName({ ...s, categoryId: "gone" })).toBe("naming-2");
  });
});
