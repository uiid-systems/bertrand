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

const { createSession, updateSessionStatus, getSession } = await import(
  "@/db/queries/sessions"
);
const { createConversation, getConversationsBySession } = await import(
  "@/db/queries/conversations"
);
const { discardSession } = await import("@/lib/session-actions");


function makeSession(
  slug: string,
  status: "active" | "waiting" | "blocked" | "paused" | "archived" = "paused",
) {
  const s = createSession({ slug });
  if (status !== "paused") updateSessionStatus(s.id, status);
  return getSession(s.id)!;
}

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
  const otherSession = createSession({
    slug: "cross-1",
    name: "cross-1",
  });
  _setDb(testDb);

  test("without db arg, a session in another project's DB is not-found", () => {
    expect(discardSession(otherSession.id)).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  test("with the owning db arg, discard succeeds", () => {
    expect(getSession(otherSession.id, otherDb)).toBeDefined();
    expect(discardSession(otherSession.id, otherDb)).toEqual({ ok: true });
    expect(getSession(otherSession.id, otherDb)).toBeUndefined();
  });
});
