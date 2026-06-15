import { describe, test, expect, beforeAll } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import * as schema from "../schema";
import { _setDb } from "../client";

// One temp DB shared across the whole file — emit helpers are pure write
// paths so a shared store keeps the test cheap. Each test inserts a fresh
// session/conversation row to avoid bleed between cases.
const TEST_DB_PATH = join(mkdtempSync(join(tmpdir(), "bertrand-emit-")), "test.db");
const sqlite = new Database(TEST_DB_PATH);
sqlite.exec("PRAGMA foreign_keys = ON");
const testDb = drizzle(sqlite, { schema });
_setDb(testDb);
migrate(drizzle(sqlite), {
  migrationsFolder: join(import.meta.dir, "..", "migrations"),
});

const { createCategory } = await import("../queries/categories");
const { createSession } = await import("../queries/sessions");
const { createConversation } = await import("../queries/conversations");
const { getEventsBySession } = await import("../queries/events");
const emit = await import("./emit");

let sessionId: string;
let conversationId: string;

beforeAll(() => {
  const cat = createCategory({ slug: "test-cat", name: "test" });
  const session = createSession({
    categoryId: cat.id,
    slug: "emit-test",
    name: "emit test",
  });
  sessionId = session.id;
  const convo = createConversation({
    sessionId,
    id: "550e8400-e29b-41d4-a716-446655440000",
  });
  conversationId = convo.id;
});

function eventsOfType(type: string) {
  return getEventsBySession(sessionId).filter((e) => e.event === type);
}

describe("emit helpers — lifecycle", () => {
  test("emitSessionStarted writes the expected meta shape", () => {
    emit.emitSessionStarted({
      sessionId,
      conversationId,
      categoryPath: "engineering/feature",
      sessionName: "test session",
      sessionSlug: "test-slug",
      labels: ["wip", "ui"],
      summary: "doing the thing",
    });
    const row = eventsOfType("session.started").at(-1)!;
    expect(row.meta).toEqual({
      category_path: "engineering/feature",
      session_name: "test session",
      session_slug: "test-slug",
      labels: ["wip", "ui"],
      summary: "doing the thing",
    });
  });

  test("emitClaudeStarted preserves the snake_case keys readers depend on", () => {
    emit.emitClaudeStarted({
      sessionId,
      conversationId,
      model: "claude-opus-4-7",
      claudeVersion: "2.1.153",
      git: { branch: "main", sha: "abc123", dirty: false },
      cwd: "/tmp",
    });
    const row = eventsOfType("claude.started").at(-1)!;
    const meta = row.meta as Record<string, unknown>;
    expect(meta.claude_version).toBe("2.1.153");
    expect(meta.claude_id).toBe(conversationId);
    expect(meta.model).toBe("claude-opus-4-7");
  });

  test("emitSessionPausedByRecovery carries the stale pid", () => {
    emit.emitSessionPausedByRecovery({ sessionId, stalePid: 99999 });
    const row = eventsOfType("session.paused").at(-1)!;
    expect((row.meta as Record<string, unknown>).stale_pid).toBe(99999);
    expect(row.summary).toBe("Recovered from stale state (process not found)");
  });
});

describe("emit helpers — interaction", () => {
  test("emitSessionWaiting puts the question on summary AND meta", () => {
    emit.emitSessionWaiting({
      sessionId,
      conversationId,
      question: "Pick an option",
    });
    const row = eventsOfType("session.waiting").at(-1)!;
    expect(row.summary).toBe("Pick an option");
    expect((row.meta as Record<string, unknown>).question).toBe("Pick an option");
  });

  test("emitSessionAnswered joins answer values into the summary", () => {
    emit.emitSessionAnswered({
      sessionId,
      conversationId,
      answers: { first: "yes", second: "later" },
    });
    const row = eventsOfType("session.answered").at(-1)!;
    expect(row.summary).toBe("yes, later");
  });

  test("emitSessionRecap truncates summary at 200 chars", () => {
    const long = "x".repeat(500);
    emit.emitSessionRecap({ sessionId, conversationId, recap: long });
    const row = eventsOfType("session.recap").at(-1)!;
    expect(row.summary?.length).toBe(200);
    expect((row.meta as Record<string, unknown>).recap).toBe(long);
  });
});

describe("emit helpers — context", () => {
  test("emitContextSnapshot stringifies token counts and percentage", () => {
    emit.emitContextSnapshot({
      sessionId,
      conversationId,
      model: "claude-opus-4-7",
      inputTokens: 1234,
      cacheCreationTokens: 100,
      cacheReadTokens: 50000,
      totalContextTokens: 51334,
      remainingPct: 87,
    });
    const row = eventsOfType("context.snapshot").at(-1)!;
    const meta = row.meta as Record<string, unknown>;
    // Stringification is load-bearing — the dashboard parses these back as
    // strings via parseInt and would break if we passed numbers directly.
    expect(meta.input_tokens).toBe("1234");
    expect(meta.context_window_tokens).toBe("51334");
    expect(meta.remaining_pct).toBe("87");
    expect(row.summary).toBe("87% remaining");
  });
});

describe("emit helpers — work", () => {
  test("emitToolApplied attaches permissions array with outcome", () => {
    emit.emitToolApplied({
      sessionId,
      conversationId,
      summary: "edited a file",
      permissions: [
        {
          tool: "Edit",
          detail: "/tmp/foo.ts",
          outcome: "applied",
          count: 1,
          oldStr: "before",
          newStr: "after",
        },
      ],
    });
    const row = eventsOfType("tool.applied").at(-1)!;
    expect(row.summary).toBe("edited a file");
    const meta = row.meta as Record<string, unknown>;
    expect(meta.outcome).toBe("applied");
    expect(Array.isArray(meta.permissions)).toBe(true);
  });

  test("emitPermissionResolved defaults outcome to approved", () => {
    emit.emitPermissionResolved({
      sessionId,
      conversationId,
      tool: "Bash",
      detail: "ls /",
      outcome: "approved",
    });
    const row = eventsOfType("permission.resolve").at(-1)!;
    expect((row.meta as Record<string, unknown>).outcome).toBe("approved");
  });

  test("emitToolUsed formats Bash summaries with backticks", () => {
    emit.emitToolUsed({
      sessionId,
      conversationId,
      tool: "Bash",
      detail: "git status",
      outcome: "auto",
    });
    const row = eventsOfType("tool.used").at(-1)!;
    expect(row.summary).toBe("ran `git status`");
    const meta = row.meta as Record<string, unknown>;
    expect(meta.tool).toBe("Bash");
    expect(meta.outcome).toBe("auto");
  });

  test("emitToolUsed truncates long Bash commands at 120 chars", () => {
    emit.emitToolUsed({
      sessionId,
      conversationId,
      tool: "Bash",
      detail: "x".repeat(500),
      outcome: "auto",
    });
    const row = eventsOfType("tool.used").at(-1)!;
    // Summary is "ran `<120 chars>`" — 6 chars of wrapper + 120 of payload.
    expect(row.summary?.length).toBe(126);
  });
});

describe("emit helpers — assistant", () => {
  test("emitAssistantRecap truncates summary at 80 chars", () => {
    const long = "x".repeat(200);
    emit.emitAssistantRecap({ sessionId, conversationId, recap: long });
    const row = eventsOfType("assistant.recap").at(-1)!;
    expect(row.summary?.length).toBe(80);
    expect(row.summary?.endsWith("...")).toBe(true);
  });

  test("emitAssistantMessage carries text + thinking metrics", () => {
    emit.emitAssistantMessage({
      sessionId,
      conversationId,
      text: "Hello there",
      model: "claude-opus-4-7",
      thinkingBlocks: 3,
      thinkingBytes: 1024,
      summary: "Hello there",
    });
    const row = eventsOfType("assistant.message").at(-1)!;
    const meta = row.meta as Record<string, unknown>;
    expect(meta.text).toBe("Hello there");
    expect(meta.thinkingBlocks).toBe(3);
    expect(meta.thinkingBytes).toBe(1024);
  });
});
