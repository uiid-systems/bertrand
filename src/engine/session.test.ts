import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as schema from "@/db/schema";
import { _setDb } from "@/db/client";

const TEST_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "bertrand-session-test-")),
  "test.db",
);

const sqlite = new Database(TEST_DB_PATH);
sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec("PRAGMA foreign_keys = ON");
const testDb = drizzle(sqlite, { schema });
_setDb(testDb);

migrate(drizzle(sqlite), {
  migrationsFolder: import.meta.dir + "/../db/migrations",
});

const { createCategory } = await import("@/db/queries/categories");
const { createSession, getSession, updateSession } = await import(
  "@/db/queries/sessions"
);
const { _setLiveSession, _forceFinalizeLive } = await import("./session");

function makeActiveSession(slug: string) {
  const category = createCategory({ slug: `g-${slug}`, name: `G ${slug}` });
  const session = createSession({
    categoryId: category.id,
    slug,
    name: slug,
  });
  updateSession(session.id, { status: "active", pid: 99999 });
  return session;
}

afterEach(() => _setLiveSession(null));

describe("forceFinalizeLive (process exit safety net)", () => {
  test("flips an active live session to paused with pid=null and endedAt set", () => {
    const session = makeActiveSession("active-flip");
    _setLiveSession({ sessionId: session.id, claudeId: "claude-1" });

    _forceFinalizeLive();

    const after = getSession(session.id);
    expect(after?.status).toBe("paused");
    expect(after?.pid).toBeNull();
    expect(after?.endedAt).toBeTruthy();
  });

  test("flips a waiting live session to paused too", () => {
    const session = makeActiveSession("waiting-flip");
    updateSession(session.id, { status: "waiting" });
    _setLiveSession({ sessionId: session.id, claudeId: "claude-2" });

    _forceFinalizeLive();

    expect(getSession(session.id)?.status).toBe("paused");
  });

  test("no-op when liveSession is null", () => {
    const session = makeActiveSession("null-tracker");
    // Tracker not set — simulates the post-finalize state.

    _forceFinalizeLive();

    // Row untouched: still active.
    expect(getSession(session.id)?.status).toBe("active");
  });

  test("no-op when the session row was deleted (discard already ran)", () => {
    const session = makeActiveSession("deleted");
    _setLiveSession({ sessionId: session.id, claudeId: "claude-3" });
    // Simulate discard removing the row out from under the tracker.
    sqlite.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);

    expect(() => _forceFinalizeLive()).not.toThrow();
    expect(getSession(session.id)).toBeUndefined();
  });

  test("no-op when the session is already paused (normal finalize ran)", () => {
    const session = makeActiveSession("already-paused");
    const finalEndedAt = "2024-01-01T00:00:00.000Z";
    updateSession(session.id, {
      status: "paused",
      pid: null,
      endedAt: finalEndedAt,
    });
    _setLiveSession({ sessionId: session.id, claudeId: "claude-4" });

    _forceFinalizeLive();

    const after = getSession(session.id);
    // endedAt should NOT have been rewritten by the safety net.
    expect(after?.endedAt).toBe(finalEndedAt);
  });
});
