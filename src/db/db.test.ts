import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdtempSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as schema from "./schema.ts";
import { _setDb } from "./client.ts";

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
const { createGroup, getGroupByPath, getOrCreateGroupPath } = await import("./queries/groups.ts");
const { createSession, getSession, getActiveSessions, updateSessionStatus } = await import("./queries/sessions.ts");
const { insertEvent, getEventsBySession } = await import("./queries/events.ts");
const { createConversation, getConversationsBySession } = await import("./queries/conversations.ts");
const { createLabel, addLabelToSession, getLabelsForSession } = await import("./queries/labels.ts");
const { upsertSessionStats, getSessionStats } = await import("./queries/stats.ts");

describe("groups", () => {
  test("create root group", () => {
    const group = createGroup({ slug: "uiid", name: "UIID" });
    expect(group.id).toBeTruthy();
    expect(group.path).toBe("uiid");
    expect(group.depth).toBe(0);
  });

  test("create nested group", () => {
    const root = getGroupByPath("uiid");
    const child = createGroup({
      slug: "bertrand",
      name: "Bertrand",
      parentId: root!.id,
    });
    expect(child.path).toBe("uiid/bertrand");
    expect(child.depth).toBe(1);
  });

  test("getOrCreateGroupPath creates full tree", () => {
    const id = getOrCreateGroupPath("personal/learning");
    expect(id).toBeTruthy();
    const group = getGroupByPath("personal/learning");
    expect(group).toBeTruthy();
    expect(group!.depth).toBe(1);
  });
});

describe("sessions", () => {
  test("create and retrieve session", () => {
    const group = getGroupByPath("uiid/bertrand")!;
    const session = createSession({
      groupId: group.id,
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
    const group = getGroupByPath("uiid/bertrand")!;
    const session = createSession({
      groupId: group.id,
      slug: "port-hooks",
      name: "port-hooks",
    });
    const updated = updateSessionStatus(session.id, "working");
    expect(updated!.status).toBe("working");
  });

  test("get active sessions", () => {
    const active = getActiveSessions();
    expect(active.length).toBeGreaterThan(0);
    expect(active[0]!.session.status).toBe("working");
  });
});

describe("events", () => {
  test("insert and query events", () => {
    const group = getGroupByPath("uiid/bertrand")!;
    const session = createSession({
      groupId: group.id,
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
      event: "session.block",
      summary: "What should we do next?",
      meta: { question: "What should we do next?" },
    });

    const events = getEventsBySession(session.id);
    expect(events.length).toBe(2);
    expect(events[0]!.event).toBe("session.started");
    expect(events[1]!.event).toBe("session.block");
  });
});

describe("conversations", () => {
  test("create and query conversations", () => {
    const group = getGroupByPath("uiid/bertrand")!;
    const session = createSession({
      groupId: group.id,
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

    const group = getGroupByPath("uiid/bertrand")!;
    const session = createSession({
      groupId: group.id,
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
    const group = getGroupByPath("uiid/bertrand")!;
    const session = createSession({
      groupId: group.id,
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
    });

    const updated = getSessionStats(session.id);
    expect(updated!.eventCount).toBe(50);
  });
});
