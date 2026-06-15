import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdtempSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as schema from "./schema";
import { _setDb } from "./client";

// Set up test DB in a unique temp directory to avoid parallel run collisions
const TEST_DB_PATH = join(mkdtempSync(join(tmpdir(), "bertrand-test-")), "test.db");

const sqlite = new Database(TEST_DB_PATH);
sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec("PRAGMA foreign_keys = ON");

const testDb = drizzle(sqlite, { schema });
_setDb(testDb);

migrate(drizzle(sqlite), {
  migrationsFolder: import.meta.dir + "/migrations",
});

// Now import query modules — they'll use the injected test DB
const { createCategory, getCategoryByPath, getOrCreateCategoryPath } = await import("./queries/categories.ts");
const { createSession, getSession, getActiveSessions, setSessionRating, updateSessionStatus } = await import("./queries/sessions.ts");
const { insertEvent, getEventsBySession, getLatestEventOfType } = await import("./queries/events.ts");
const { createConversation, getConversationsBySession } = await import("./queries/conversations.ts");
const { createLabel, addLabelToSession, getLabelsForSession } = await import("./queries/labels.ts");
const { upsertSessionStats, getSessionStats } = await import("./queries/stats.ts");

describe("categories", () => {
  test("create root category", () => {
    const category = createCategory({ slug: "uiid", name: "UIID" });
    expect(category.id).toBeTruthy();
    expect(category.path).toBe("uiid");
    expect(category.depth).toBe(0);
  });

  test("create nested category", () => {
    const root = getCategoryByPath("uiid");
    const child = createCategory({
      slug: "bertrand",
      name: "Bertrand",
      parentId: root!.id,
    });
    expect(child.path).toBe("uiid/bertrand");
    expect(child.depth).toBe(1);
  });

  test("getOrCreateCategoryPath creates full tree", () => {
    const id = getOrCreateCategoryPath("personal/learning");
    expect(id).toBeTruthy();
    const category = getCategoryByPath("personal/learning");
    expect(category).toBeTruthy();
    expect(category!.depth).toBe(1);
  });
});

describe("sessions", () => {
  test("create and retrieve session", () => {
    const category = getCategoryByPath("uiid/bertrand")!;
    const session = createSession({
      categoryId: category.id,
      slug: "fix-auth-bug",
      name: "fix-auth-bug",
    });
    expect(session.id).toBeTruthy();
    expect(session.status).toBe("paused");

    const retrieved = getSession(session.id);
    expect(retrieved).toBeTruthy();
    expect(retrieved!.slug).toBe("fix-auth-bug");
  });

  test("update session status", () => {
    const category = getCategoryByPath("uiid/bertrand")!;
    const session = createSession({
      categoryId: category.id,
      slug: "port-hooks",
      name: "port-hooks",
    });
    const updated = updateSessionStatus(session.id, "active");
    expect(updated!.status).toBe("active");
  });

  test("get active sessions", () => {
    const active = getActiveSessions();
    expect(active.length).toBeGreaterThan(0);
    expect(active[0]!.session.status).toBe("active");
  });

  test("session rating defaults to null and can be set, updated, and cleared", () => {
    const category = getCategoryByPath("uiid/bertrand")!;
    const session = createSession({
      categoryId: category.id,
      slug: "rating-test",
      name: "rating-test",
    });
    expect(session.rating).toBeNull();

    const rated = setSessionRating(session.id, 4);
    expect(rated.rating).toBe(4);
    expect(getSession(session.id)!.rating).toBe(4);

    const rerated = setSessionRating(session.id, 2);
    expect(rerated.rating).toBe(2);

    const cleared = setSessionRating(session.id, null);
    expect(cleared.rating).toBeNull();
    expect(getSession(session.id)!.rating).toBeNull();
  });
});

describe("events", () => {
  test("insert and query events", () => {
    const category = getCategoryByPath("uiid/bertrand")!;
    const session = createSession({
      categoryId: category.id,
      slug: "event-test",
      name: "event-test",
    });

    insertEvent({
      sessionId: session.id,
      event: "session.started",
      meta: { version: 1 },
    });

    insertEvent({
      sessionId: session.id,
      event: "session.waiting",
      summary: "What should we do next?",
      meta: { question: "What should we do next?" },
    });

    const events = getEventsBySession(session.id);
    expect(events.length).toBe(2);
    expect(events[0]!.event).toBe("session.started");
    expect(events[1]!.event).toBe("session.waiting");
  });

  test("getLatestEventOfType returns the most recent event for the given type", () => {
    // Dedup in the per-turn assistant-message capture relies on this query.
    const category = getCategoryByPath("uiid/bertrand")!;
    const session = createSession({
      categoryId: category.id,
      slug: "latest-event-test",
      name: "latest-event-test",
    });

    insertEvent({
      sessionId: session.id,
      event: "assistant.message",
      meta: { text: "first" },
    });
    insertEvent({
      sessionId: session.id,
      event: "user.prompt",
      meta: { prompt: "interleaved" },
    });
    insertEvent({
      sessionId: session.id,
      event: "assistant.message",
      meta: { text: "second" },
    });

    const latest = getLatestEventOfType(session.id, "assistant.message");
    expect(latest).toBeDefined();
    expect((latest!.meta as Record<string, unknown>).text).toBe("second");

    const missing = getLatestEventOfType(session.id, "nonexistent.type");
    expect(missing).toBeUndefined();
  });

  test("getLatestEventOfType scopes to conversationId when provided", () => {
    // Per-turn capture dedup must not collapse identical text across
    // different conversations within one bertrand session.
    const category = getCategoryByPath("uiid/bertrand")!;
    const session = createSession({
      categoryId: category.id,
      slug: "convo-scoped-test",
      name: "convo-scoped-test",
    });
    const convoA = createConversation({
      id: "550e8400-e29b-41d4-a716-446655440010",
      sessionId: session.id,
    });
    const convoB = createConversation({
      id: "550e8400-e29b-41d4-a716-446655440011",
      sessionId: session.id,
    });

    insertEvent({
      sessionId: session.id,
      conversationId: convoA.id,
      event: "assistant.message",
      meta: { text: "from A" },
    });
    insertEvent({
      sessionId: session.id,
      conversationId: convoB.id,
      event: "assistant.message",
      meta: { text: "from B" },
    });

    const latestForA = getLatestEventOfType(session.id, "assistant.message", convoA.id);
    expect((latestForA!.meta as Record<string, unknown>).text).toBe("from A");

    const latestForB = getLatestEventOfType(session.id, "assistant.message", convoB.id);
    expect((latestForB!.meta as Record<string, unknown>).text).toBe("from B");

    // No conversation scope still returns the session-wide latest.
    const sessionWide = getLatestEventOfType(session.id, "assistant.message");
    expect((sessionWide!.meta as Record<string, unknown>).text).toBe("from B");
  });
});

describe("conversations", () => {
  test("create and query conversations", () => {
    const category = getCategoryByPath("uiid/bertrand")!;
    const session = createSession({
      categoryId: category.id,
      slug: "conv-test",
      name: "conv-test",
    });

    createConversation({ id: "test-claude-id-1", sessionId: session.id });
    createConversation({ id: "test-claude-id-2", sessionId: session.id });

    const convos = getConversationsBySession(session.id);
    expect(convos.length).toBe(2);
  });
});

describe("labels", () => {
  test("create label and attach to session", () => {
    const label = createLabel({ name: "code-review", color: "#4EA7FC" });
    expect(label.name).toBe("code-review");

    const category = getCategoryByPath("uiid/bertrand")!;
    const session = createSession({
      categoryId: category.id,
      slug: "label-test",
      name: "label-test",
    });

    addLabelToSession(session.id, label.id);
    const sessionLabels = getLabelsForSession(session.id);
    expect(sessionLabels.length).toBe(1);
    expect(sessionLabels[0]!.name).toBe("code-review");
  });
});

describe("stats", () => {
  test("upsert session stats", () => {
    const category = getCategoryByPath("uiid/bertrand")!;
    const session = createSession({
      categoryId: category.id,
      slug: "stats-test",
      name: "stats-test",
    });

    upsertSessionStats(session.id, {
      eventCount: 42,
      conversationCount: 3,
      interactionCount: 15,
      prCount: 2,
      claudeWorkS: 300,
      userWaitS: 120,
      activePct: 71,
      durationS: 420,
      linesAdded: 0,
      linesRemoved: 0,
      filesTouched: 0,
    });

    const stats = getSessionStats(session.id);
    expect(stats).toBeTruthy();
    expect(stats!.eventCount).toBe(42);
    expect(stats!.prCount).toBe(2);

    // Upsert again — should update, not duplicate
    upsertSessionStats(session.id, {
      eventCount: 50,
      conversationCount: 4,
      interactionCount: 20,
      prCount: 3,
      claudeWorkS: 400,
      userWaitS: 150,
      activePct: 73,
      durationS: 550,
      linesAdded: 0,
      linesRemoved: 0,
      filesTouched: 0,
    });

    const updated = getSessionStats(session.id);
    expect(updated!.eventCount).toBe(50);
  });
});
