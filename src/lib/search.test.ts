import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as schema from "@/db/schema";
import { _setDb } from "@/db/client";

const TEST_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "bertrand-search-test-")),
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
const { insertEvent } = await import("@/db/queries/events");
const { searchProject, makeSnippet } = await import("./search");

const cat = createCategory({ slug: "cli", name: "cli" });
const s1 = createSession({ categoryId: cat.id, slug: "auth-work", name: "auth-work" });
const s2 = createSession({ categoryId: cat.id, slug: "other", name: "other" });
updateSession(s2.id, { summary: "refactored the auth token flow → shipped" });

const convoA = "aaaaaaaa-0000-0000-0000-000000000001";
const convoB = "bbbbbbbb-0000-0000-0000-000000000002";
createConversation({ id: convoA, sessionId: s1.id });
createConversation({ id: convoB, sessionId: s1.id });

insertEvent({
  sessionId: s1.id,
  conversationId: convoA,
  event: "user.prompt",
  meta: { prompt: "let's fix the OAuth token refresh bug" },
  createdAt: "2026-07-01 10:00:00",
});
insertEvent({
  sessionId: s1.id,
  conversationId: convoB,
  event: "session.waiting",
  meta: { question: "Rotate the token signing key now?" },
  createdAt: "2026-07-02 10:00:00",
});
insertEvent({
  sessionId: s1.id,
  conversationId: convoB,
  event: "session.answered",
  meta: { answers: { "Rotate the token signing key now?": "Yes, rotate it" } },
  createdAt: "2026-07-02 10:01:00",
});
insertEvent({
  sessionId: s1.id,
  conversationId: convoB,
  event: "assistant.message",
  meta: { text: "Rotated the signing key and updated the token validation" },
  createdAt: "2026-07-02 10:02:00",
});
insertEvent({
  sessionId: s1.id,
  conversationId: convoB,
  event: "tool.used",
  meta: { tool: "Bash", detail: "openssl genrsa -out token-signing.pem", outcome: "auto" },
  createdAt: "2026-07-02 10:03:00",
});

describe("searchProject", () => {
  test("finds hits across default types with conversation ordinals, newest first", () => {
    const hits = searchProject(testDb, "proj", { terms: ["token"] });
    const types = hits.map((h) => h.type);
    expect(types).toContain("prompt");
    expect(types).toContain("question");
    expect(types).toContain("answer");
    expect(types).toContain("assistant");
    expect(types).toContain("summary");
    expect(types).not.toContain("tool"); // opt-in only

    const prompt = hits.find((h) => h.type === "prompt")!;
    expect(prompt.session).toBe("cli/auth-work");
    expect(prompt.conversation).toBe(1);
    const question = hits.find((h) => h.type === "question")!;
    expect(question.conversation).toBe(2);

    // Newest first
    const times = hits.map((h) => new Date(h.at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  test("terms are AND-ed", () => {
    expect(searchProject(testDb, "p", { terms: ["token", "refresh"] }).map((h) => h.type)).toEqual([
      "prompt",
    ]);
    expect(searchProject(testDb, "p", { terms: ["token", "zzz-no-match"] })).toEqual([]);
  });

  test("matching is case-insensitive", () => {
    const hits = searchProject(testDb, "p", { terms: ["OAUTH"] });
    expect(hits.length).toBe(1);
    expect(hits[0]!.type).toBe("prompt");
  });

  test("tool type is searchable when requested", () => {
    const hits = searchProject(testDb, "p", { terms: ["openssl"], types: ["tool"] });
    expect(hits.length).toBe(1);
    expect(hits[0]!.snippet).toContain("openssl genrsa");
  });

  test("--session filter restricts event and summary hits", () => {
    const hits = searchProject(testDb, "p", { terms: ["token"], session: "cli/other" });
    expect(hits.length).toBe(1);
    expect(hits[0]!.type).toBe("summary");
    expect(hits[0]!.session).toBe("cli/other");
  });

  test("limit caps merged results", () => {
    const hits = searchProject(testDb, "p", { terms: ["token"], limit: 2 });
    expect(hits.length).toBe(2);
  });

  test("LIKE wildcards in terms are treated literally", () => {
    expect(searchProject(testDb, "p", { terms: ["%"] })).toEqual([]);
    expect(searchProject(testDb, "p", { terms: ["_"] })).toEqual([]);
  });

  test("ordinals match log's event segmentation when legacy events lead the session", () => {
    const s3 = createSession({ categoryId: cat.id, slug: "legacy-lead", name: "legacy-lead" });
    const convo = "cccccccc-0000-0000-0000-000000000003";
    // Legacy pre-tracking conversation: null conversationId, own claude.started.
    insertEvent({
      sessionId: s3.id,
      event: "claude.started",
      meta: {},
      createdAt: "2026-06-01 10:00:00",
    });
    insertEvent({
      sessionId: s3.id,
      event: "user.prompt",
      meta: { prompt: "legacy work" },
      createdAt: "2026-06-01 10:01:00",
    });
    // Tracked conversation added on resume.
    createConversation({ id: convo, sessionId: s3.id });
    insertEvent({
      sessionId: s3.id,
      conversationId: convo,
      event: "user.prompt",
      meta: { prompt: "tracked xylophone work" },
      createdAt: "2026-06-02 10:00:00",
    });

    const hits = searchProject(testDb, "p", { terms: ["xylophone"] });
    expect(hits.length).toBe(1);
    // The conversations table alone would say ordinal 1; event segmentation
    // (what `log --events --conversation N` uses) puts the legacy segment
    // first, so the tracked conversation is ordinal 2.
    expect(hits[0]!.conversation).toBe(2);
  });

  test("uppercase non-ASCII terms match exact-case text", () => {
    const s4 = createSession({ categoryId: cat.id, slug: "unicode", name: "unicode" });
    insertEvent({
      sessionId: s4.id,
      event: "user.prompt",
      meta: { prompt: "die Übergabe planen" },
    });
    const hits = searchProject(testDb, "p", { terms: ["Übergabe"] });
    expect(hits.length).toBe(1);
    expect(hits[0]!.session).toBe("cli/unicode");
  });
});

describe("makeSnippet", () => {
  test("windows around the match and collapses whitespace", () => {
    const text = "a".repeat(200) + " the\n\nNEEDLE sits here " + "b".repeat(200);
    const snippet = makeSnippet(text, "needle");
    expect(snippet).toContain("NEEDLE sits here");
    expect(snippet).not.toContain("\n");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet.length).toBeLessThan(180);
  });
});
