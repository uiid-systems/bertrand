import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { randomUUID } from "crypto";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as schema from "@/db/schema";
import { _setDb } from "@/db/client";

const TEST_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "bertrand-recovery-test-")),
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
const { createConversation, getConversation } = await import(
  "@/db/queries/conversations"
);
const { recoverStaleSessions } = await import("./recovery");

const DEAD_PID = 2_147_483_600;
const A_WEEK_AGO = Date.now() - 7 * 24 * 3_600_000;

let n = 0;
function makeSession(opts: { pid: number | null; pidStartedAt: number | null }) {
  const slug = `s${n++}`;
  const category = createCategory({ slug: `c-${slug}`, name: slug });
  const session = createSession({ categoryId: category.id, slug, name: slug });
  updateSession(session.id, {
    status: "active",
    pid: opts.pid,
    pidStartedAt: opts.pidStartedAt,
  });
  return session.id;
}

describe("recoverStaleSessions", () => {
  test("recovers a session whose process is gone", async () => {
    const id = makeSession({ pid: DEAD_PID, pidStartedAt: Date.now() });
    await recoverStaleSessions();
    const row = getSession(id)!;
    expect(row.status).toBe("paused");
    expect(row.pid).toBeNull();
    expect(row.pidStartedAt).toBeNull();
  });

  test("runs the same bookkeeping as a clean exit", async () => {
    // Recovery routes through finalizeSessionRow, so a crashed session gets
    // an end time like any other. Before #209 it was paused without one,
    // which left its duration stats wrong forever.
    const id = makeSession({ pid: DEAD_PID, pidStartedAt: Date.now() });
    await recoverStaleSessions();
    expect(getSession(id)!.endedAt).toBeTruthy();
  });

  test("ends the session's most recent conversation", async () => {
    const id = makeSession({ pid: DEAD_PID, pidStartedAt: Date.now() });
    const convId = randomUUID();
    createConversation({ id: convId, sessionId: id });
    await recoverStaleSessions();
    expect(getConversation(convId)!.endedAt).toBeTruthy();
  });

  test("finalizes a session that has no conversation rows", async () => {
    const id = makeSession({ pid: DEAD_PID, pidStartedAt: Date.now() });
    await recoverStaleSessions();
    expect(getSession(id)!.status).toBe("paused");
  });

  test("leaves a genuinely live session alone", async () => {
    const id = makeSession({ pid: process.pid, pidStartedAt: Date.now() });
    await recoverStaleSessions();
    expect(getSession(id)!.status).toBe("active");
  });

  test("recovers a session whose pid was recycled", async () => {
    // The #209 failure mode: the recorded pid is live again as an unrelated
    // process. A bare kill(pid, 0) reads it as alive, so the row would stay
    // `active` forever. Identity must catch it.
    const id = makeSession({ pid: process.pid, pidStartedAt: A_WEEK_AGO });
    await recoverStaleSessions();
    expect(getSession(id)!.status).toBe("paused");
  });

  test("a legacy row with no pidStartedAt still recovers when the pid is dead", async () => {
    const id = makeSession({ pid: DEAD_PID, pidStartedAt: null });
    await recoverStaleSessions();
    expect(getSession(id)!.status).toBe("paused");
  });

  test("a legacy row with a live pid is left alone rather than assumed dead", async () => {
    // Pre-#209 rows carry no identity. Degrade to liveness-only rather than
    // reaping every session written before the column existed.
    const id = makeSession({ pid: process.pid, pidStartedAt: null });
    await recoverStaleSessions();
    expect(getSession(id)!.status).toBe("active");
  });

  test("ignores sessions with no pid at all", async () => {
    const id = makeSession({ pid: null, pidStartedAt: null });
    await recoverStaleSessions();
    expect(getSession(id)!.status).toBe("active");
  });

  test("returns the number of sessions it recovered", async () => {
    makeSession({ pid: DEAD_PID, pidStartedAt: Date.now() });
    makeSession({ pid: DEAD_PID, pidStartedAt: Date.now() });
    const recovered = await recoverStaleSessions();
    expect(recovered).toBe(2);
  });
});
