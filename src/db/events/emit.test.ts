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
  test("emitClaudeStarted records claude_id and cwd", () => {
    emit.emitClaudeStarted({
      sessionId,
      conversationId,
      cwd: "/tmp",
    });
    const row = eventsOfType("claude.started").at(-1)!;
    const meta = row.meta as Record<string, unknown>;
    expect(meta.claude_id).toBe(conversationId);
    expect(meta.cwd).toBe("/tmp");
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

describe("emit helpers — worktree", () => {
  test("emitWorktreeEntered records path + branch with a branch summary", () => {
    emit.emitWorktreeEntered({
      sessionId,
      conversationId,
      path: "/repo/.claude/worktrees/feat-x",
      branch: "worktree-feat-x",
    });
    const row = eventsOfType("worktree.entered").at(-1)!;
    expect(row.summary).toBe("entered worktree worktree-feat-x");
    const meta = row.meta as Record<string, unknown>;
    expect(meta.path).toBe("/repo/.claude/worktrees/feat-x");
    expect(meta.branch).toBe("worktree-feat-x");
  });

  test("emitWorktreeEntered falls back to a generic summary without a branch", () => {
    emit.emitWorktreeEntered({
      sessionId,
      conversationId,
      path: "/repo/.claude/worktrees/feat-y",
    });
    const row = eventsOfType("worktree.entered").at(-1)!;
    expect(row.summary).toBe("entered worktree");
  });

  test("emitWorktreeExited records the exit and carries the path", () => {
    emit.emitWorktreeExited({
      sessionId,
      conversationId,
      path: "/repo/.claude/worktrees/feat-x",
    });
    const row = eventsOfType("worktree.exited").at(-1)!;
    expect(row.summary).toBe("exited worktree");
    expect((row.meta as Record<string, unknown>).path).toBe(
      "/repo/.claude/worktrees/feat-x",
    );
  });
});
