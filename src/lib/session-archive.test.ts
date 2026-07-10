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

const { createCategory } = await import("@/db/queries/categories");
const { createSession, updateSessionStatus, getSession } = await import(
  "@/db/queries/sessions"
);
const { archiveSession, unarchiveSession, archiveAllPaused } = await import(
  "@/lib/session-archive"
);

const category = createCategory({ slug: "archive-test", name: "Archive Test" });

function makeSession(slug: string, status: "active" | "waiting" | "paused" | "archived") {
  const s = createSession({ categoryId: category.id, slug, name: slug });
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

describe("archiveSession / unarchiveSession with explicit db (cross-project)", () => {
  // Reproduces the dashboard multi-project bug: a session living in a
  // non-active project's DB. Without the db arg the lookup hits the active DB
  // and returns not-found; passing the owning DB resolves and mutates it.
  const otherSqlite = new Database(
    join(mkdtempSync(join(tmpdir(), "bertrand-archive-other-")), "other.db"),
  );
  otherSqlite.exec("PRAGMA journal_mode = WAL");
  otherSqlite.exec("PRAGMA foreign_keys = ON");
  const otherDb = drizzle(otherSqlite, { schema });
  migrate(drizzle(otherSqlite), {
    migrationsFolder: join(import.meta.dir, "..", "db", "migrations"),
  });

  // Seed a paused session into the other DB by pointing the query layer at it
  // transiently, then restore the active (test) DB.
  _setDb(otherDb);
  const otherCategory = createCategory({ slug: "other-proj", name: "Other" });
  const otherSession = createSession({
    categoryId: otherCategory.id,
    slug: "cross-1",
    name: "cross-1",
  });
  _setDb(testDb);

  test("without db arg, a session in another project's DB is not-found", () => {
    const result = archiveSession(otherSession.id);
    expect(result).toEqual({ ok: false, reason: "not-found" });
  });

  test("with the owning db arg, archive succeeds", () => {
    const result = archiveSession(otherSession.id, otherDb);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.session.status).toBe("archived");
    expect(getSession(otherSession.id, otherDb)!.status).toBe("archived");
  });

  test("with the owning db arg, unarchive succeeds", () => {
    const result = unarchiveSession(otherSession.id, otherDb);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.session.status).toBe("paused");
    expect(getSession(otherSession.id, otherDb)!.status).toBe("paused");
  });
});

describe("archiveAllPaused", () => {
  test("archives only paused sessions, skips active/waiting/archived", () => {
    // Fresh category to isolate from prior tests
    const c = createCategory({ slug: "batch", name: "Batch" });
    const paused1 = createSession({ categoryId: c.id, slug: "p1", name: "p1" });
    const paused2 = createSession({ categoryId: c.id, slug: "p2", name: "p2" });
    const active = createSession({ categoryId: c.id, slug: "a1", name: "a1" });
    updateSessionStatus(active.id, "active");
    const waiting = createSession({ categoryId: c.id, slug: "w1", name: "w1" });
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
