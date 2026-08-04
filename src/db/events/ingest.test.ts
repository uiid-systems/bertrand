import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import * as schema from "../schema";
import { _setDb, _clearTestDb } from "../client";
import { ingestTranscript } from "./ingest";

const workDir = mkdtempSync(join(tmpdir(), "bertrand-ingest-"));

const sqlite = new Database(join(workDir, "test.db"));
sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec("PRAGMA foreign_keys = ON");
const testDb = drizzle(sqlite, { schema });

const { createCategory } = await import("../queries/categories");
const { createSession } = await import("../queries/sessions");
const { createConversation, getConversation } = await import("../queries/conversations");
const { getEventsBySession } = await import("../queries/events");

let sessionId: string;
let conversationId: string;

beforeAll(() => {
  _setDb(testDb);
  migrate(drizzle(sqlite), { migrationsFolder: import.meta.dir + "/../migrations" });
  const category = createCategory({ slug: "test", name: "Test" });
  const session = createSession({
    categoryId: category.id,
    slug: "ingest-test",
    name: "ingest-test",
  });
  sessionId = session.id;
  conversationId = createConversation({
    id: "550e8400-e29b-41d4-a716-446655440099",
    sessionId,
  }).id;
});

afterAll(() => {
  _clearTestDb();
  rmSync(workDir, { recursive: true, force: true });
});

// -- JSONL entry builders --
// Timestamps are strictly monotonic across the whole suite: the session is
// shared and events sort by createdAt, so every new entry must postdate all
// previously ingested ones for `.at(-1)`/count-slicing to be deterministic.

const BASE_MS = Date.UTC(2026, 6, 9, 10, 0, 0);
let tick = 0;
let seq = 0;

function nextStamp(): string {
  return new Date(BASE_MS + ++tick * 1000).toISOString();
}

function userPrompt(text: string) {
  return { type: "user", message: { role: "user", content: text } };
}

function toolResult() {
  return {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tu", content: "ok" }],
    },
  };
}

function assistantText(text: string) {
  return {
    type: "assistant",
    uuid: `text-${++seq}`,
    timestamp: nextStamp(),
    message: {
      role: "assistant",
      model: "claude-fable-5",
      content: [{ type: "text", text }],
    },
  };
}

function assistantThinking(sigBytes: number) {
  return {
    type: "assistant",
    uuid: `think-${++seq}`,
    timestamp: nextStamp(),
    message: {
      role: "assistant",
      model: "claude-fable-5",
      content: [{ type: "thinking", thinking: "", signature: "x".repeat(sigBytes) }],
    },
  };
}

function assistantToolUse(name = "Bash") {
  return {
    type: "assistant",
    uuid: `tool-${++seq}`,
    timestamp: nextStamp(),
    message: {
      role: "assistant",
      model: "claude-fable-5",
      content: [{ type: "tool_use", id: "tu", name, input: {} }],
    },
  };
}

function jsonl(entries: unknown[]): string {
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

let fileSeq = 0;
function transcriptFile(entries: unknown[]): string {
  const path = join(workDir, `transcript-${++fileSeq}.jsonl`);
  writeFileSync(path, jsonl(entries));
  return path;
}

function ingest(transcriptPath: string, flush = false) {
  return ingestTranscript({ sessionId, conversationId, transcriptPath, flush });
}

function assistantEvents() {
  return getEventsBySession(sessionId).filter((e) => e.event === "assistant.message");
}

describe("ingestTranscript", () => {
  test("emits one event per text-bearing entry, with thinking attached and backdated createdAt", () => {
    const think = assistantThinking(2000);
    const t1 = assistantText("Let me look at the hooks first.");
    const t2 = assistantText("Found it — capture happens at Stop.");
    const t3 = assistantText("Here is what I found.");
    const path = transcriptFile([
      userPrompt("audit the system"),
      think,
      t1,
      assistantToolUse(),
      toolResult(),
      t2,
      assistantToolUse(),
      toolResult(),
      t3,
    ]);

    const before = assistantEvents().length;
    const { emitted } = ingest(path);
    expect(emitted).toBe(3);

    const rows = assistantEvents().slice(before);
    expect(rows.length).toBe(3);

    const metas = rows.map((r) => r.meta as Record<string, unknown>);
    expect(metas.map((m) => m.text)).toEqual([
      "Let me look at the hooks first.",
      "Found it — capture happens at Stop.",
      "Here is what I found.",
    ]);
    // Thinking attaches to the first following text, then resets.
    expect(metas.map((m) => m.thinkingBlocks)).toEqual([1, 0, 0]);
    expect(metas[0]!.thinkingBytes).toBe(2000);
    expect(metas[0]!.uuid).toBe(t1.uuid);
    expect(metas[0]!.timestamp).toBe(t1.timestamp);
    expect(metas[0]!.model).toBe("claude-fable-5");
    // createdAt backdated to the transcript timestamp, sqlite format.
    expect(rows[0]!.createdAt).toBe(t1.timestamp.replace("T", " ").slice(0, 19));
    expect(rows[0]!.conversationId).toBe(conversationId);
  });

  test("cursor advances — re-ingest is a no-op; appended entries emit only the delta", () => {
    const path = transcriptFile([userPrompt("go"), assistantText("first")]);
    expect(ingest(path).emitted).toBe(1);
    expect(ingest(path).emitted).toBe(0);

    appendFileSync(path, jsonl([assistantText("second")]));
    expect(ingest(path).emitted).toBe(1);
    expect(ingest(path).emitted).toBe(0);
  });

  test("an unterminated tail line is deferred until its newline arrives", () => {
    const path = transcriptFile([userPrompt("go")]);
    const entry = JSON.stringify(assistantText("partial"));
    const cut = Math.floor(entry.length / 2);

    appendFileSync(path, entry.slice(0, cut));
    expect(ingest(path).emitted).toBe(0);

    appendFileSync(path, entry.slice(cut) + "\n");
    expect(ingest(path).emitted).toBe(1);
  });

  test("trailing thinking flushes as a thinking-only event, exactly once", () => {
    const path = transcriptFile([
      userPrompt("go"),
      assistantThinking(6000),
      assistantToolUse("AskUserQuestion"),
    ]);

    // Mid-turn tick: pending thinking is held, not emitted.
    expect(ingest(path, false).emitted).toBe(0);

    // Turn-end tick: flushed once…
    const before = assistantEvents().length;
    expect(ingest(path, true).emitted).toBe(1);
    const row = assistantEvents().at(-1)!;
    expect(row.summary).toBe("thinking only");
    const meta = row.meta as Record<string, unknown>;
    expect(meta.thinkingBlocks).toBe(1);
    expect(meta.thinkingBytes).toBe(6000);

    // …and never again.
    expect(ingest(path, true).emitted).toBe(0);
    expect(assistantEvents().length).toBe(before + 1);
  });

  test("pending thinking survives across ticks and attaches to the next text", () => {
    const path = transcriptFile([userPrompt("go"), assistantThinking(1000)]);
    expect(ingest(path).emitted).toBe(0);

    appendFileSync(path, jsonl([assistantText("after thinking")]));
    expect(ingest(path).emitted).toBe(1);
    const meta = assistantEvents().at(-1)!.meta as Record<string, unknown>;
    expect(meta.text).toBe("after thinking");
    expect(meta.thinkingBlocks).toBe(1);
    expect(meta.thinkingBytes).toBe(1000);
  });

  test("truncated file resets the cursor and dedups by uuid", () => {
    const kept = assistantText("kept entry");
    const dropped = assistantText("this line gets truncated away padding padding padding");
    const path = transcriptFile([userPrompt("go"), kept, dropped]);
    expect(ingest(path).emitted).toBe(2);

    // File replaced by a shorter one containing an already-ingested entry.
    writeFileSync(path, jsonl([userPrompt("go"), kept]));
    expect(ingest(path).emitted).toBe(0);

    // New content after the reset still lands.
    appendFileSync(path, jsonl([assistantText("fresh after reset")]));
    expect(ingest(path).emitted).toBe(1);
  });

  test("sidechain (subagent) entries are skipped", () => {
    const side = { ...assistantText("subagent chatter"), isSidechain: true };
    const path = transcriptFile([userPrompt("go"), side, assistantText("main line")]);
    const { emitted } = ingest(path);
    expect(emitted).toBe(1);
    const meta = assistantEvents().at(-1)!.meta as Record<string, unknown>;
    expect(meta.text).toBe("main line");
  });

  test("missing file is a no-op", () => {
    expect(ingest(join(workDir, "nope.jsonl")).emitted).toBe(0);
  });
});

describe("token usage", () => {
  // The session and conversation are shared across the whole suite, so every
  // assertion here is on the *delta* a single ingest produced.
  function usage() {
    const c = getConversation(conversationId)!;
    return {
      input: c.inputTokens,
      output: c.outputTokens,
      cacheCreation: c.cacheCreationTokens,
      cacheRead: c.cacheReadTokens,
      model: c.model,
    };
  }

  function delta(before: ReturnType<typeof usage>) {
    const after = usage();
    return {
      input: after.input - before.input,
      output: after.output - before.output,
      cacheCreation: after.cacheCreation - before.cacheCreation,
      cacheRead: after.cacheRead - before.cacheRead,
    };
  }

  function withUsage(
    entry: Record<string, unknown>,
    counts: {
      input?: number;
      output?: number;
      cacheCreation?: number;
      cacheRead?: number;
    },
  ) {
    const message = entry.message as Record<string, unknown>;
    return {
      ...entry,
      message: {
        ...message,
        usage: {
          input_tokens: counts.input ?? 0,
          output_tokens: counts.output ?? 0,
          cache_creation_input_tokens: counts.cacheCreation ?? 0,
          cache_read_input_tokens: counts.cacheRead ?? 0,
        },
      },
    };
  }

  test("accumulates across ticks", () => {
    const before = usage();
    const path = transcriptFile([
      userPrompt("go"),
      withUsage(assistantText("first"), { input: 10, output: 5, cacheRead: 100 }),
    ]);
    ingest(path);

    appendFileSync(
      path,
      jsonl([withUsage(assistantText("second"), { input: 7, output: 3, cacheCreation: 40 })]),
    );
    ingest(path);

    expect(delta(before)).toEqual({
      input: 17,
      output: 8,
      cacheCreation: 40,
      cacheRead: 100,
    });
  });

  test("counts sidechain (subagent) tokens but not their model", () => {
    const before = usage();
    const side = withUsage(
      { ...assistantText("subagent chatter"), isSidechain: true },
      { input: 500, output: 250 },
    );
    // A subagent may run a different model than the main agent.
    (side.message as Record<string, unknown>).model = "claude-haiku-4-5-20251001";

    const path = transcriptFile([
      userPrompt("go"),
      side,
      withUsage(assistantText("main line"), { input: 1, output: 2 }),
    ]);
    const { emitted } = ingest(path);

    // The subagent's chatter stays out of the timeline...
    expect(emitted).toBe(1);
    // ...but its tokens are still billed to this conversation.
    expect(delta(before)).toEqual({
      input: 501,
      output: 252,
      cacheCreation: 0,
      cacheRead: 0,
    });
    expect(usage().model).toBe("claude-fable-5");
  });

  // Note: a reset *replaces* the shared conversation's totals, discarding what
  // the tests above accumulated onto it — later tests here must assert on
  // deltas, not absolutes. In production a conversation maps to exactly one
  // transcript, so replacing is correct: the re-read covers the entire file.
  test("cursor reset replaces totals instead of double-counting", () => {
    const kept = withUsage(assistantText("kept"), { input: 60, output: 20 });
    const dropped = withUsage(assistantText("dropped"), { input: 30, output: 10 });

    const before = usage();
    const path = transcriptFile([userPrompt("go"), kept, dropped]);
    ingest(path);
    expect(delta(before)).toMatchObject({ input: 90, output: 30 });

    // Replace with a *shorter* file so the cursor points past EOF and the
    // whole file is re-read. Totals must be replaced, not added to.
    writeFileSync(path, jsonl([userPrompt("go"), kept]));
    ingest(path);
    expect(usage().input).toBe(60);
    expect(usage().output).toBe(20);
  });

  /** Stamp a message.id, as real Claude Code output carries on every entry. */
  function withId(entry: Record<string, unknown>, id: string) {
    const message = entry.message as Record<string, unknown>;
    return { ...entry, message: { ...message, id } };
  }

  // Claude Code writes one entry per content block of an assistant message,
  // and each repeats that message's `usage` verbatim. Measured on real
  // transcripts: 349 usage-bearing entries for 151 messages, inflating output
  // tokens 2.8x. Usage must be billed once per message.
  test("bills usage once per message.id, not once per content-block entry", () => {
    const before = usage();
    const counts = { input: 10, output: 100, cacheRead: 5000 };
    const path = transcriptFile([
      userPrompt("go"),
      withId(withUsage(assistantText("block one"), counts), "msg_abc"),
      withId(withUsage(assistantText("block two"), counts), "msg_abc"),
      withId(withUsage(assistantText("block three"), counts), "msg_abc"),
    ]);
    ingest(path);

    expect(delta(before)).toEqual({
      input: 10,
      output: 100,
      cacheCreation: 0,
      cacheRead: 5000,
    });
  });

  test("distinct message ids each bill their own usage", () => {
    const before = usage();
    const path = transcriptFile([
      userPrompt("go"),
      withId(withUsage(assistantText("first"), { input: 3, output: 7 }), "msg_a"),
      withId(withUsage(assistantText("second"), { input: 4, output: 9 }), "msg_b"),
    ]);
    ingest(path);

    expect(delta(before)).toMatchObject({ input: 7, output: 16 });
  });

  // The reason the id is persisted on the cursor rather than kept in a local:
  // a message's blocks can land either side of a tick boundary.
  test("dedupes a message whose blocks straddle a tick boundary", () => {
    const before = usage();
    const counts = { input: 20, output: 200 };
    const path = transcriptFile([
      userPrompt("go"),
      withId(withUsage(assistantText("block one"), counts), "msg_split"),
    ]);
    ingest(path);

    appendFileSync(
      path,
      jsonl([withId(withUsage(assistantText("block two"), counts), "msg_split")]),
    );
    ingest(path);

    expect(delta(before)).toMatchObject({ input: 20, output: 200 });
  });

  test("entries without usage leave totals untouched", () => {
    const before = usage();
    const path = transcriptFile([userPrompt("go"), assistantText("no usage block")]);
    ingest(path);
    expect(delta(before)).toEqual({
      input: 0,
      output: 0,
      cacheCreation: 0,
      cacheRead: 0,
    });
  });
});
