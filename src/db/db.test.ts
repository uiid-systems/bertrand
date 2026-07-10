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
const { createSession, getSession, getActiveSessions, getAllSessions, setSessionRating, updateSessionStatus } = await import("./queries/sessions.ts");
const { insertEvent, getEventsBySession } = await import("./queries/events.ts");
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

  test("blocked ('needs approval') sessions count as live and survive the excludeArchived filter", () => {
    // Regression: `blocked` was added as a live state (permission request) but
    // the live/list queries still enumerated only active/waiting/paused, so a
    // "needs approval" card silently vanished from the sidebar entirely.
    const category = getCategoryByPath("uiid/bertrand")!;
    const session = createSession({
      categoryId: category.id,
      slug: "needs-approval",
      name: "needs-approval",
    });
    updateSessionStatus(session.id, "blocked");

    const active = getActiveSessions();
    expect(active.some((s) => s.session.id === session.id)).toBe(true);

    const listed = getAllSessions({ excludeArchived: true });
    expect(listed.some((s) => s.session.id === session.id)).toBe(true);
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

  test("insertEvent honors a createdAt override", () => {
    // Transcript ingestion backdates assistant.message rows to when Claude
    // actually said them, so timeline ordering matches reality.
    const category = getCategoryByPath("uiid/bertrand")!;
    const session = createSession({
      categoryId: category.id,
      slug: "created-at-test",
      name: "created-at-test",
    });

    insertEvent({
      sessionId: session.id,
      event: "tool.used",
      meta: { tool: "Bash" },
    });
    insertEvent({
      sessionId: session.id,
      event: "assistant.message",
      meta: { text: "backdated" },
      createdAt: "2020-01-01 00:00:00",
    });

    const rows = getEventsBySession(session.id);
    expect(rows.length).toBe(2);
    // Ordered by createdAt — the backdated assistant message sorts first.
    expect(rows[0]!.event).toBe("assistant.message");
    expect(rows[0]!.createdAt).toBe("2020-01-01 00:00:00");
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

    // Upsert again — should update, not duplicate
    upsertSessionStats(session.id, {
      eventCount: 50,
      conversationCount: 4,
      interactionCount: 20,
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
