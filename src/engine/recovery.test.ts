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

const { createSession, getSession, updateSession } = await import(
  "@/db/queries/sessions"
);
const { createConversation, getConversation } = await import(
  "@/db/queries/conversations"
);
const { insertEvent } = await import("@/db/queries/events");
const { getSessionStats } = await import("@/db/queries/stats");
const { formatDbTime, parseDbTime } = await import("@/lib/format");
const { recoverStaleSessions } = await import("./recovery");

const DEAD_PID = 2_147_483_600;
const A_WEEK_AGO = Date.now() - 7 * 24 * 3_600_000;

let n = 0;
function makeSession(opts: {
  pid: number | null;
  pidStartedAt: number | null;
  status?: "active" | "paused" | "archived";
}) {
  const slug = `s${n++}`;
  const session = createSession({ slug });
  updateSession(session.id, {
    status: opts.status ?? "active",
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

  test("finalizes a paused session whose process is gone", async () => {
    // How an adopted session ends: the Stop hook pauses it and there is no
    // bertrand process to finalize it, so recovery is the only thing that
    // ever will. Scoped to live statuses, this row was invisible — it kept a
    // pid and an empty endedAt forever, and never materialized its stats.
    const id = makeSession({
      pid: DEAD_PID,
      pidStartedAt: Date.now(),
      status: "paused",
    });

    await recoverStaleSessions();

    const row = getSession(id)!;
    expect(row.pid).toBeNull();
    expect(row.endedAt).toBeTruthy();
  });

  test("leaves a paused session alone while its process runs", async () => {
    // `paused` is where every turn that didn't end on AskUserQuestion lands,
    // with claude still very much alive. Finalizing on status alone would end
    // sessions mid-conversation.
    const id = makeSession({
      pid: process.pid,
      pidStartedAt: Date.now(),
      status: "paused",
    });

    await recoverStaleSessions();

    expect(getSession(id)!.endedAt).toBeNull();
    expect(getSession(id)!.pid).toBe(process.pid);
  });

  test("never finalizes the same session twice", async () => {
    makeSession({ pid: DEAD_PID, pidStartedAt: Date.now(), status: "paused" });

    expect(await recoverStaleSessions()).toBe(1);
    // Finalizing nulls the pid, which is what takes the row out of the
    // candidate set — otherwise every sweep would re-end every paused session.
    expect(await recoverStaleSessions()).toBe(0);
  });

  test("leaves archived sessions alone", async () => {
    const id = makeSession({
      pid: DEAD_PID,
      pidStartedAt: Date.now(),
      status: "archived",
    });

    await recoverStaleSessions();

    // Archiving is deliberate. Reanimating one to emit an ended event would
    // resurrect it in every view that filters on status.
    expect(getSession(id)!.status).toBe("archived");
  });

  test("returns the number of sessions it recovered", async () => {
    makeSession({ pid: DEAD_PID, pidStartedAt: Date.now() });
    makeSession({ pid: DEAD_PID, pidStartedAt: Date.now() });
    const recovered = await recoverStaleSessions();
    expect(recovered).toBe(2);
  });
});

describe("recoverStaleSessions — when the session ended", () => {
  // Second-aligned: the stored format has no sub-second component.
  const FIVE_DAYS_AGO = Math.floor(Date.now() / 1000) * 1000 - 5 * 86_400_000;

  test("dates the end to the session's last event, not the sweep", async () => {
    // How an adopted session actually ends: claude worked for a minute, asked a
    // question, and the user closed the terminal five days ago. Nothing was
    // standing over it, so this sweep is the first thing to notice.
    const id = makeSession({
      pid: DEAD_PID,
      pidStartedAt: Date.now(),
      status: "paused",
    });
    insertEvent({
      sessionId: id,
      event: "claude.started",
      createdAt: formatDbTime(FIVE_DAYS_AGO),
    });
    insertEvent({
      sessionId: id,
      event: "session.waiting",
      createdAt: formatDbTime(FIVE_DAYS_AGO + 60_000),
    });

    await recoverStaleSessions();

    expect(parseDbTime(getSession(id)!.endedAt!)).toBe(FIVE_DAYS_AGO + 60_000);

    // The whole point of dating it back. computeTimings closes the open period
    // at claude.ended, so a sweep-clock end would have recorded the five days
    // the terminal sat closed as time this session spent waiting on its user.
    const stats = getSessionStats(id)!;
    expect(stats.claudeWorkS).toBe(60);
    expect(stats.userWaitS).toBe(0);
    expect(stats.durationS).toBe(60);
  });

  test("dates the end in the same shape startedAt is stored in", async () => {
    const id = makeSession({
      pid: DEAD_PID,
      pidStartedAt: Date.now(),
      status: "paused",
    });

    await recoverStaleSessions();

    // The two are subtracted to get a session's duration. SQLite's zone-less
    // strings read as local time, so an ISO endedAt against a `datetime('now')`
    // startedAt came out short by the machine's UTC offset.
    const row = getSession(id)!;
    const STORED = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
    expect(row.startedAt).toMatch(STORED);
    expect(row.endedAt).toMatch(STORED);
  });

  test("falls back to now for a session that recorded nothing", async () => {
    const id = makeSession({
      pid: DEAD_PID,
      pidStartedAt: Date.now(),
      status: "paused",
    });
    const before = Date.now();

    await recoverStaleSessions();

    // No evidence to date it by, and no open period for `now` to inflate.
    expect(Date.parse(getSession(id)!.endedAt!)).toBeGreaterThanOrEqual(
      before - 1_000,
    );
  });
});
