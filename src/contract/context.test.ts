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
  mkdtempSync(join(tmpdir(), "bertrand-context-test-")),
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

const { createSession, updateSession, updateSessionStatus } = await import(
  "@/db/queries/sessions"
);
const { buildSiblingContext } = await import("./context");


const current = createSession({ slug: "current" });

describe("buildSiblingContext", () => {
  test("empty project (only the current session) yields no block", () => {
    expect(buildSiblingContext(current.id)).toBe("");
  });

  test("includes non-archived sessions, excludes current and archived", () => {
    const sameCat = createSession({ slug: "same-cat" });
    updateSession(sameCat.id, { summary: "trimmed the logs → shipped PR #9" });

    createSession({ slug: "other-cat" });

    const archived = createSession({ slug: "archived" });
    updateSessionStatus(archived.id, "archived");

    const block = buildSiblingContext(current.id);
    expect(block).toContain("## Sibling Sessions");
    expect(block).toContain("- same-cat:");
    expect(block).toContain('"trimmed the logs → shipped PR #9"');
    expect(block).toContain("- other-cat:");
    expect(block).not.toContain("- archived:");
    expect(block).not.toContain("- current:");
    expect(block).toContain("bertrand log <session>");
  });

  test("lazily backfills a missing summary without bumping updatedAt", async () => {
    const { insertEvent } = await import("@/db/queries/events");
    const { getSession } = await import("@/db/queries/sessions");

    const legacy = createSession({ slug: "legacy" });
    insertEvent({ sessionId: legacy.id, event: "user.prompt", meta: { prompt: "old work" } });
    // Backdate so a bumped updatedAt would be detectable.
    sqlite.exec(`UPDATE sessions SET updated_at = '2026-01-01 00:00:00' WHERE id = '${legacy.id}'`);

    const block = buildSiblingContext(current.id);
    expect(block).toContain('- legacy: paused — "old work"');
    expect(getSession(legacy.id)?.summary).toBe("old work");
    expect(getSession(legacy.id)?.updatedAt).toBe("2026-01-01 00:00:00");
  });

  test("caps the list and reports the overflow", () => {
    for (let i = 0; i < 15; i++) {
      createSession({ slug: `bulk-${i}` });
    }
    const block = buildSiblingContext(current.id);
    const bulletCount = block.split("\n").filter((l) => l.startsWith("- ")).length;
    // 12 session lines + 1 overflow line
    expect(bulletCount).toBe(13);
    expect(block).toMatch(/plus \d+ more — run `bertrand list`/);
  });
});
