import { describe, test, expect, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as schema from "@/db/schema";
import { _setDb } from "@/db/client";

const TEST_DIR = mkdtempSync(join(tmpdir(), "bertrand-diffstats-test-"));
const sqlite = new Database(join(TEST_DIR, "test.db"));
sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec("PRAGMA foreign_keys = ON");

const testDb = drizzle(sqlite, { schema });
_setDb(testDb);

migrate(drizzle(sqlite), {
  migrationsFolder: join(import.meta.dir, "..", "db", "migrations"),
});

const { createSession } = await import("@/db/queries/sessions");
const { createConversation } = await import("@/db/queries/conversations");
const { emitToolApplied } = await import("@/db/events/emit");
const { computeDiffStats } = await import("@/lib/diff_stats");

afterAll(() => rmSync(TEST_DIR, { recursive: true, force: true }));

let n = 0;

/** A session with one edit per path, each adding a single line. */
function sessionEditing(...paths: string[]) {
  const slug = `diffstats-${n++}`;
  const session = createSession({ slug });
  const conversationId = crypto.randomUUID();
  createConversation({ id: conversationId, sessionId: session.id });

  emitToolApplied({
    sessionId: session.id,
    conversationId,
    summary: "edited",
    permissions: paths.map((detail) => ({
      tool: "Edit",
      detail,
      outcome: "applied" as const,
      count: 1,
      newStr: "added line",
    })),
  });

  return session.id;
}

describe("computeDiffStats", () => {
  // The counters behind `session_stats` and the `bertrand log` digest. They
  // see only what `tool.applied` records — Edit/Write/MultiEdit — so a session
  // that edits through Bash reports nothing here. That is a known limit, not a
  // bug to fix in this function; see the ELKY-189 notes on why nothing in the
  // UI ranks on these numbers.
  test("a session with no edits reports zeroes", () => {
    const slug = `diffstats-empty-${n++}`;
    const session = createSession({ slug });
    expect(computeDiffStats(session.id)).toEqual({
      linesAdded: 0,
      linesRemoved: 0,
      filesTouched: 0,
    });
  });

  test("counts one file per distinct path", () => {
    const id = sessionEditing("/repo/a.ts", "/repo/b.ts");
    expect(computeDiffStats(id).filesTouched).toBe(2);
  });

  test("repeated edits to one path are still one file", () => {
    const id = sessionEditing("/repo/a.ts", "/repo/a.ts", "/repo/a.ts");
    expect(computeDiffStats(id).filesTouched).toBe(1);
  });

  test("tallies added lines across every edit", () => {
    // sessionEditing writes a single-line newStr per path and no oldStr.
    const stats = computeDiffStats(sessionEditing("/repo/a.ts", "/repo/b.ts"));
    expect(stats.linesAdded).toBe(2);
    expect(stats.linesRemoved).toBe(0);
  });
});
