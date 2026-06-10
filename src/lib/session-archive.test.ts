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
  mkdtempSync(join(tmpdir(), "bertrand-archive-test-")),
  "test.db"
);

const sqlite = new Database(TEST_DB_PATH);
sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec("PRAGMA foreign_keys = ON");

const testDb = drizzle(sqlite, { schema });
_setDb(testDb);

migrate(drizzle(sqlite), {
  migrationsFolder: join(import.meta.dir, "..", "db", "migrations"),
});

const { createGroup } = await import("@/db/queries/groups");
const { createSession, updateSessionStatus, getSession } = await import(
  "@/db/queries/sessions"
);
const { archiveSession, unarchiveSession, archiveAllPaused } = await import(
  "@/lib/session-archive"
);

const group = createGroup({ slug: "archive-test", name: "Archive Test" });

function makeSession(slug: string, status: "active" | "waiting" | "paused" | "archived") {
  const s = createSession({ groupId: group.id, slug, name: slug });
  if (status !== "paused") updateSessionStatus(s.id, status);
  return getSession(s.id)!;
}

describe("archiveSession", () => {
  test("archives a paused session", () => {
    const s = makeSession("paused-1", "paused");
    const result = archiveSession(s.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.session.status).toBe("archived");
  });

  test("refuses to archive an active session", () => {
    const s = makeSession("active-1", "active");
    const result = archiveSession(s.id);
    expect(result).toEqual({ ok: false, reason: "active" });
  });

  test("refuses to archive a waiting session", () => {
    const s = makeSession("waiting-1", "waiting");
    const result = archiveSession(s.id);
    expect(result).toEqual({ ok: false, reason: "active" });
  });

  test("refuses an already-archived session", () => {
    const s = makeSession("archived-1", "archived");
    const result = archiveSession(s.id);
    expect(result).toEqual({ ok: false, reason: "already-archived" });
  });

  test("returns not-found for unknown id", () => {
    const result = archiveSession("nope");
    expect(result).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("unarchiveSession", () => {
  test("unarchives an archived session to paused", () => {
    const s = makeSession("archived-2", "archived");
    const result = unarchiveSession(s.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.session.status).toBe("paused");
  });

  test("refuses to unarchive a paused session", () => {
    const s = makeSession("paused-2", "paused");
    const result = unarchiveSession(s.id);
    expect(result).toEqual({ ok: false, reason: "not-archived" });
  });

  test("refuses to unarchive an active session", () => {
    const s = makeSession("active-2", "active");
    const result = unarchiveSession(s.id);
    expect(result).toEqual({ ok: false, reason: "not-archived" });
  });

  test("returns not-found for unknown id", () => {
    const result = unarchiveSession("nope");
    expect(result).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("archiveAllPaused", () => {
  test("archives only paused sessions, skips active/waiting/archived", () => {
    // Fresh group to isolate from prior tests
    const g = createGroup({ slug: "batch", name: "Batch" });
    const paused1 = createSession({ groupId: g.id, slug: "p1", name: "p1" });
    const paused2 = createSession({ groupId: g.id, slug: "p2", name: "p2" });
    const active = createSession({ groupId: g.id, slug: "a1", name: "a1" });
    updateSessionStatus(active.id, "active");
    const waiting = createSession({ groupId: g.id, slug: "w1", name: "w1" });
    updateSessionStatus(waiting.id, "waiting");

    const { archived } = archiveAllPaused();
    const archivedIds = archived.map((r) => r.session.id);

    expect(archivedIds).toContain(paused1.id);
    expect(archivedIds).toContain(paused2.id);
    expect(archivedIds).not.toContain(active.id);
    expect(archivedIds).not.toContain(waiting.id);

    expect(getSession(paused1.id)!.status).toBe("archived");
    expect(getSession(paused2.id)!.status).toBe("archived");
    expect(getSession(active.id)!.status).toBe("active");
    expect(getSession(waiting.id)!.status).toBe("waiting");
  });
});
