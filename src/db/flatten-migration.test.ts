import { describe, test, expect, beforeAll } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

/**
 * Migration 0018 — flatten categories into flat session slugs.
 *
 * Builds a genuinely pre-0018 database by replaying migrations 0000..0017 from
 * a trimmed copy of the migrations folder, seeds the taxonomy the migration
 * must survive (slug collisions, a nested legacy category, child rows on every
 * FK), then runs the full folder and asserts the flattened result.
 */

const MIGRATIONS_DIR = join(import.meta.dir, "migrations");

/** Copy migrations 0000..0017 + a journal trimmed to them into a temp dir. */
function makePre0018Folder(): string {
  const dir = mkdtempSync(join(tmpdir(), "bertrand-pre0018-"));
  mkdirSync(join(dir, "meta"), { recursive: true });
  for (const f of readdirSync(MIGRATIONS_DIR)) {
    if (f.endsWith(".sql") && !f.startsWith("0018")) {
      cpSync(join(MIGRATIONS_DIR, f), join(dir, f));
    }
  }
  const journal = JSON.parse(
    JSON.stringify(
      require(join(MIGRATIONS_DIR, "meta", "_journal.json")),
    ),
  ) as { entries: { idx: number }[] };
  journal.entries = journal.entries.filter((e) => e.idx <= 17);
  writeFileSync(
    join(dir, "meta", "_journal.json"),
    JSON.stringify(journal, null, 2),
  );
  return dir;
}

function openDb(path: string): Database {
  const sqlite = new Database(path);
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");
  return sqlite;
}

const DB_PATH = join(mkdtempSync(join(tmpdir(), "bertrand-0018-test-")), "test.db");

function seedPre0018(sqlite: Database): void {
  const insertCategory = sqlite.prepare(
    "INSERT INTO categories (id, parent_id, slug, name, path, depth) VALUES (?, ?, ?, ?, ?, ?)",
  );
  insertCategory.run("cat-diff", null, "diff", "diff", "diff", 0);
  insertCategory.run("cat-md", null, "markdown", "markdown", "markdown", 0);
  insertCategory.run("cat-x", null, "xtra", "xtra", "xtra", 0);
  // Legacy nested category (depth > 0), pre-#129 era.
  insertCategory.run("cat-a", null, "aa", "aa", "aa", 0);
  insertCategory.run("cat-ab", "cat-a", "bb", "bb", "aa/bb", 1);

  const insertSession = sqlite.prepare(
    `INSERT INTO sessions (id, category_id, slug, name, status, started_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  // Slug collision: earliest started_at must keep the bare slug.
  insertSession.run("s-early", "cat-diff", "fix-colors", "fix-colors", "archived", "2025-01-01 10:00:00");
  insertSession.run("s-late", "cat-md", "fix-colors", "fix-colors", "archived", "2025-06-01 10:00:00");
  // Suffix robustness: two sessions named "x" plus one already holding "x-2",
  // so the rank suffix for the losing "x" lands on a taken name and the
  // id-derived fallback has to kick in.
  insertSession.run("s-x1", "cat-diff", "x", "x", "paused", "2025-02-01 10:00:00");
  insertSession.run("s-x2", "cat-md", "x", "x", "paused", "2025-03-01 10:00:00");
  insertSession.run("s-x2-taken", "cat-x", "x-2", "x-2", "paused", "2025-01-15 10:00:00");
  // Session under a nested (depth 1) category — alias must use the full path.
  insertSession.run("s-nested", "cat-ab", "deep-work", "deep-work", "paused", "2025-04-01 10:00:00");

  // Child rows on every table that references sessions.id — the rebuild must
  // not cascade any of these away.
  sqlite.exec(
    `INSERT INTO conversations (id, session_id) VALUES ('conv-1', 's-early');
     INSERT INTO events (session_id, conversation_id, event) VALUES ('s-early', 'conv-1', 'claude.started');
     INSERT INTO session_stats (session_id, event_count) VALUES ('s-early', 1);
     INSERT INTO labels (id, name) VALUES ('lab-1', 'test-label');
     INSERT INTO session_labels (session_id, label_id) VALUES ('s-early', 'lab-1');
     INSERT INTO session_aliases (alias, session_id) VALUES ('diff/pre-existing-alias', 's-early');`,
  );
}

/**
 * Mirrors the real call sites (db/client.ts, db/migrate.ts): foreign_keys ON
 * before migrating. 0018 manages its own enforcement window — that's part of
 * what this suite proves.
 */
function runMigrationsFrom(path: string, folder: string): void {
  const sqlite = openDb(path);
  try {
    migrate(drizzle(sqlite), { migrationsFolder: folder });
  } finally {
    sqlite.close();
  }
}

beforeAll(() => {
  runMigrationsFrom(DB_PATH, makePre0018Folder());
  const sqlite = openDb(DB_PATH);
  seedPre0018(sqlite);
  sqlite.close();

  runMigrationsFrom(DB_PATH, MIGRATIONS_DIR);
});

describe("migration 0018 (flatten categories)", () => {
  test("every session survives, children intact", () => {
    const db = openDb(DB_PATH);
    expect(db.query("SELECT count(*) n FROM sessions").get()).toEqual({ n: 6 });
    expect(db.query("SELECT count(*) n FROM events").get()).toEqual({ n: 1 });
    expect(db.query("SELECT count(*) n FROM conversations").get()).toEqual({ n: 1 });
    expect(db.query("SELECT count(*) n FROM session_stats").get()).toEqual({ n: 1 });
    expect(db.query("SELECT count(*) n FROM session_labels").get()).toEqual({ n: 1 });
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  test("categories table and sessions.category_id are gone", () => {
    const db = openDb(DB_PATH);
    expect(
      db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='categories'").get(),
    ).toBeNull();
    const cols = db.query("SELECT name FROM pragma_table_info('sessions')").all() as {
      name: string;
    }[];
    expect(cols.map((c) => c.name)).not.toContain("category_id");
    db.close();
  });

  test("aliases cover every pre-existing session, nested paths included", () => {
    const db = openDb(DB_PATH);
    const alias = (a: string) =>
      (db.query("SELECT session_id FROM session_aliases WHERE alias = ?").get(a) as
        | { session_id: string }
        | null)?.session_id;
    expect(alias("diff/fix-colors")).toBe("s-early");
    expect(alias("markdown/fix-colors")).toBe("s-late");
    expect(alias("aa/bb/deep-work")).toBe("s-nested");
    expect(alias("diff/x")).toBe("s-x1");
    expect(alias("markdown/x")).toBe("s-x2");
    expect(alias("xtra/x-2")).toBe("s-x2-taken");
    // Pre-existing alias rows are untouched (INSERT OR IGNORE).
    expect(alias("diff/pre-existing-alias")).toBe("s-early");
    db.close();
  });

  test("collision losers are suffixed by started_at order; earliest keeps the bare slug", () => {
    const db = openDb(DB_PATH);
    const slug = (id: string) =>
      (db.query("SELECT slug FROM sessions WHERE id = ?").get(id) as { slug: string }).slug;
    expect(slug("s-early")).toBe("fix-colors");
    expect(slug("s-late")).toBe("fix-colors-2");
    db.close();
  });

  test("a taken rank suffix falls back to an id-derived suffix", () => {
    const db = openDb(DB_PATH);
    const slug = (id: string) =>
      (db.query("SELECT slug FROM sessions WHERE id = ?").get(id) as { slug: string }).slug;
    expect(slug("s-x1")).toBe("x");
    expect(slug("s-x2-taken")).toBe("x-2");
    // s-x2's rank suffix "x-2" was taken; the fallback appends its id prefix.
    expect(slug("s-x2")).toBe("x-2-s-x2");
    const slugs = db.query("SELECT slug FROM sessions").all() as { slug: string }[];
    expect(new Set(slugs.map((s) => s.slug)).size).toBe(slugs.length);
    db.close();
  });

  test("slug uniqueness is enforced by index", () => {
    const db = openDb(DB_PATH);
    expect(() =>
      db.exec(
        "INSERT INTO sessions (id, slug, name) VALUES ('s-dup', 'fix-colors', 'fix-colors')",
      ),
    ).toThrow(/UNIQUE/);
    db.close();
  });

  test("a second full run is a no-op", () => {
    const before = openDb(DB_PATH)
      .query("SELECT id, slug, name FROM sessions ORDER BY id")
      .all();
    const aliasesBefore = openDb(DB_PATH)
      .query("SELECT alias, session_id FROM session_aliases ORDER BY alias")
      .all();

    runMigrationsFrom(DB_PATH, MIGRATIONS_DIR);

    const db = openDb(DB_PATH);
    expect(db.query("SELECT id, slug, name FROM sessions ORDER BY id").all()).toEqual(before);
    expect(
      db.query("SELECT alias, session_id FROM session_aliases ORDER BY alias").all(),
    ).toEqual(aliasesBefore);
    db.close();
  });
});
