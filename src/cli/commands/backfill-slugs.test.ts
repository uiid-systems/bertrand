import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { eq } from "drizzle-orm";

import * as schema from "@/db/schema";
import { _setDb } from "@/db/client";

const TEST_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "bertrand-backfill-slugs-")),
  "test.db",
);
const sqlite = new Database(TEST_DB_PATH);
sqlite.exec("PRAGMA foreign_keys = ON");
const testDb = drizzle(sqlite, { schema });
_setDb(testDb);
migrate(drizzle(sqlite), {
  migrationsFolder: join(import.meta.dir, "..", "..", "db", "migrations"),
});

const { createSession, getSession, resolveSessionByName, updateSession } =
  await import("@/db/queries/sessions");
const { runBackfillSlugs } = await import("./backfill-slugs");

/** A session as creation left it before branch seeding existed. */
function placeholder(slug: string, branch: string | null) {
  return createSession({ slug, nameSource: "derived", branch });
}

describe("runBackfillSlugs", () => {
  test("renames a placeholder after its branch and keeps the old name resolving", () => {
    const s = placeholder("new-0dqjum", "ui-182");

    const { renames } = runBackfillSlugs();

    expect(renames).toContainEqual({ from: "new-0dqjum", to: "ui-182" });
    expect(getSession(s.id)!.slug).toBe("ui-182");
    // The old name must still reach the session — anything already typed or
    // linked would otherwise 404.
    expect(resolveSessionByName("new-0dqjum")?.session.id).toBe(s.id);
  });

  test("stays 'derived' so a later pause can still improve the name", () => {
    const s = placeholder("new-aaaaaa", "ui-900");
    runBackfillSlugs();
    expect(getSession(s.id)!.nameSource).toBe("derived");
  });

  test("does not bump updatedAt", () => {
    // Renaming the whole corpus must not reorder the sidebar's recency sort.
    // Pinned to a distant value rather than compared before/after: SQLite's
    // datetime('now') is second-granular, so a bump inside the same second
    // would read as unchanged and the assertion would pass vacuously.
    const s = placeholder("new-bbbbbb", "ui-901");
    testDb
      .update(schema.sessions)
      .set({ updatedAt: "2020-01-01 00:00:00" })
      .where(eq(schema.sessions.id, s.id))
      .run();

    runBackfillSlugs();

    const after = getSession(s.id)!;
    expect(after.slug).toBe("ui-901");
    expect(after.updatedAt).toBe("2020-01-01 00:00:00");
  });

  test("leaves manual names alone even when they look like placeholders", () => {
    // A hand-typed name is the user's word. `nameSource` is the guard.
    const s = createSession({ slug: "new-abc123", branch: "ui-902" });
    expect(getSession(s.id)!.nameSource).toBe("manual");

    runBackfillSlugs();

    expect(getSession(s.id)!.slug).toBe("new-abc123");
  });

  test("leaves derived names that aren't placeholder-shaped", () => {
    const s = placeholder("new-onboarding-flow", "ui-903");
    runBackfillSlugs();
    expect(getSession(s.id)!.slug).toBe("new-onboarding-flow");
  });

  test("accepts the old nanoid alphabet, which could emit - and _", () => {
    const dashed = placeholder("new-etxcb-", "ui-904");
    const scored = placeholder("new-b_ecel", "ui-905");

    runBackfillSlugs();

    expect(getSession(dashed.id)!.slug).toBe("ui-904");
    expect(getSession(scored.id)!.slug).toBe("ui-905");
  });

  test("skips a session with no branch, and counts it", () => {
    const s = placeholder("new-cccccc", null);
    const { noBranch } = runBackfillSlugs();
    expect(noBranch).toBeGreaterThanOrEqual(1);
    expect(getSession(s.id)!.slug).toBe("new-cccccc");
  });

  test("skips a default branch, which names no particular work", () => {
    const s = placeholder("new-dddddd", "main");
    const { unusableBranch } = runBackfillSlugs();
    expect(unusableBranch).toBeGreaterThanOrEqual(1);
    expect(getSession(s.id)!.slug).toBe("new-dddddd");
  });

  test("disambiguates two placeholders on one branch", () => {
    const first = placeholder("new-eeeeee", "ui-906");
    const second = placeholder("new-ffffff", "ui-906");

    runBackfillSlugs();

    const slugs = [getSession(first.id)!.slug, getSession(second.id)!.slug];
    expect(slugs.sort()).toEqual(["ui-906", "ui-906-2"]);
  });

  test("--dry-run reports the renames without writing them", () => {
    const s = placeholder("new-gggggg", "ui-907");

    const { renames } = runBackfillSlugs({ dryRun: true });

    expect(renames).toContainEqual({ from: "new-gggggg", to: "ui-907" });
    expect(getSession(s.id)!.slug).toBe("new-gggggg");
    expect(resolveSessionByName("ui-907")).toBeUndefined();
  });

  test("--dry-run previews the same names the real run assigns", () => {
    // Nothing is written under --dry-run, so the DB cannot report the
    // collision between two sessions on one branch. Without in-batch
    // bookkeeping both would preview as the bare slug while the real run hands
    // the second one -2, and the preview would be lying about its own effect.
    placeholder("new-jjjjjj", "ui-910");
    placeholder("new-kkkkkk", "ui-910");

    const mine = (rs: { from: string; to: string }[]) =>
      rs.filter((r) => r.from === "new-jjjjjj" || r.from === "new-kkkkkk");

    const preview = runBackfillSlugs({ dryRun: true }).renames;
    const actual = runBackfillSlugs().renames;

    expect(mine(preview)).toEqual(mine(actual));
    expect(mine(actual).map((r) => r.to).sort()).toEqual([
      "ui-910",
      "ui-910-2",
    ]);
  });

  test("is idempotent — a second run finds nothing", () => {
    placeholder("new-hhhhhh", "ui-908");
    runBackfillSlugs();

    const again = runBackfillSlugs();

    expect(again.renames).toEqual([]);
  });

  test("skips archived sessions unless asked", () => {
    const s = placeholder("new-iiiiii", "ui-909");
    updateSession(s.id, { status: "archived" });

    runBackfillSlugs();
    expect(getSession(s.id)!.slug).toBe("new-iiiiii");

    runBackfillSlugs({ includeArchived: true });
    expect(getSession(s.id)!.slug).toBe("ui-909");
  });
});
