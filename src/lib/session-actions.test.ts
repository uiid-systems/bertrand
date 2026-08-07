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
  mkdtempSync(join(tmpdir(), "bertrand-session-actions-test-")),
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
const { createSession, updateSessionStatus, getSession } = await import(
  "@/db/queries/sessions"
);
const { createConversation, getConversationsBySession } = await import(
  "@/db/queries/conversations"
);
const { rateSession, discardSession } = await import("@/lib/session-actions");

const category = createCategory({ slug: "actions-test", name: "Actions Test" });

function makeSession(
  slug: string,
  status: "active" | "waiting" | "blocked" | "paused" | "archived" = "paused",
) {
  const s = createSession({ categoryId: category.id, slug, name: slug });
  if (status !== "paused") updateSessionStatus(s.id, status);
  return getSession(s.id)!;
}

describe("rateSession", () => {
  test("sets a rating in range", () => {
    const s = makeSession("rate-1");
    const result = rateSession(s.id, 4);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.session.rating).toBe(4);
    expect(getSession(s.id)!.rating).toBe(4);
  });

  test("accepts both ends of the 1-5 range", () => {
    const s = makeSession("rate-bounds");
    expect(rateSession(s.id, 1).ok).toBe(true);
    expect(getSession(s.id)!.rating).toBe(1);
    expect(rateSession(s.id, 5).ok).toBe(true);
    expect(getSession(s.id)!.rating).toBe(5);
  });

  test("null clears an existing rating", () => {
    const s = makeSession("rate-clear");
    rateSession(s.id, 3);
    const result = rateSession(s.id, null);
    expect(result.ok).toBe(true);
    expect(getSession(s.id)!.rating).toBeNull();
  });

  test("rejects out-of-range and non-integer values", () => {
    const s = makeSession("rate-bad");
    for (const bad of [0, 6, -1, 2.5, NaN]) {
      expect(rateSession(s.id, bad)).toEqual({
        ok: false,
        reason: "out-of-range",
      });
    }
    expect(getSession(s.id)!.rating).toBeNull();
  });

  test("is allowed while the session is still live", () => {
    // The TUI persists a rating from its exit screen, but rating is a judgement
    // about the session rather than a lifecycle transition — nothing downstream
    // reads it mid-run, so there is no reason to refuse.
    const s = makeSession("rate-live", "active");
    expect(rateSession(s.id, 5).ok).toBe(true);
    expect(getSession(s.id)!.rating).toBe(5);
  });

  test("returns not-found for unknown id", () => {
    expect(rateSession("nope", 3)).toEqual({ ok: false, reason: "not-found" });
  });

  test("validates the rating before looking the session up", () => {
    // Order matters for the caller's error message: a bad rating on a missing
    // session should report the thing the caller can actually fix.
    expect(rateSession("nope", 99)).toEqual({
      ok: false,
      reason: "out-of-range",
    });
  });
});

describe("discardSession", () => {
  test("deletes a paused session", () => {
    const s = makeSession("discard-1");
    expect(discardSession(s.id)).toEqual({ ok: true });
    expect(getSession(s.id)).toBeUndefined();
  });

  test("deletes an archived session", () => {
    const s = makeSession("discard-archived", "archived");
    expect(discardSession(s.id)).toEqual({ ok: true });
    expect(getSession(s.id)).toBeUndefined();
  });

  test.each(["active", "waiting", "blocked"] as const)(
    "refuses to discard a %s session",
    (status) => {
      const s = makeSession(`discard-${status}`, status);
      expect(discardSession(s.id)).toEqual({ ok: false, reason: "active" });
      expect(getSession(s.id)).toBeDefined();
    },
  );

  test("returns not-found for unknown id", () => {
    expect(discardSession("nope")).toEqual({ ok: false, reason: "not-found" });
  });

  test("cascades to the session's conversations", () => {
    // The confirm dialog promises the session's whole history goes with it.
    // That is only true because every child table declares onDelete cascade AND
    // `PRAGMA foreign_keys` is ON — a pragma SQLite defaults to OFF, so this
    // asserts the guarantee rather than trusting it.
    const s = makeSession("discard-cascade");
    createConversation({ id: crypto.randomUUID(), sessionId: s.id });
    createConversation({ id: crypto.randomUUID(), sessionId: s.id });
    expect(getConversationsBySession(s.id)).toHaveLength(2);

    expect(discardSession(s.id)).toEqual({ ok: true });
    expect(getConversationsBySession(s.id)).toHaveLength(0);
  });
});

describe("with an explicit db (cross-project)", () => {
  const otherSqlite = new Database(
    join(mkdtempSync(join(tmpdir(), "bertrand-session-actions-other-")), "other.db"),
  );
  otherSqlite.exec("PRAGMA journal_mode = WAL");
  otherSqlite.exec("PRAGMA foreign_keys = ON");
  const otherDb = drizzle(otherSqlite, { schema });
  migrate(drizzle(otherSqlite), {
    migrationsFolder: join(import.meta.dir, "..", "db", "migrations"),
  });

  _setDb(otherDb);
  const otherCategory = createCategory({ slug: "other-proj", name: "Other" });
  const otherSession = createSession({
    categoryId: otherCategory.id,
    slug: "cross-1",
    name: "cross-1",
  });
  _setDb(testDb);

  test("without db arg, a session in another project's DB is not-found", () => {
    expect(rateSession(otherSession.id, 3)).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(discardSession(otherSession.id)).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  test("with the owning db arg, rate and discard succeed", () => {
    const rated = rateSession(otherSession.id, 2, otherDb);
    expect(rated.ok).toBe(true);
    expect(getSession(otherSession.id, otherDb)!.rating).toBe(2);

    expect(discardSession(otherSession.id, otherDb)).toEqual({ ok: true });
    expect(getSession(otherSession.id, otherDb)).toBeUndefined();
  });
});
