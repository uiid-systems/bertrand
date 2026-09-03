import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";

import { paths, _setRootDir } from "@/lib/paths";
import { getDb, invalidateDbCache, _clearTestDb } from "./client";

const MIGRATIONS_FOLDER = join(import.meta.dir, "migrations");

let tmpRoot: string;

beforeEach(() => {
  // A path *under* the temp dir, deliberately not created: openDb is
  // responsible for making bertrand's home on a first-ever run.
  tmpRoot = join(mkdtempSync(join(tmpdir(), "bertrand-client-")), "home");
  _setRootDir(tmpRoot);
  _clearTestDb();
});

afterEach(() => {
  _clearTestDb();
  const created = dirname(tmpRoot);
  _setRootDir(null);
  rmSync(created, { recursive: true, force: true });
});

describe("getDb()", () => {
  test("opens the one database and caches the handle", () => {
    const first = getDb();
    const second = getDb();
    expect(first).toBe(second);
  });

  test("creates bertrand's home directory on first open", () => {
    expect(existsSync(tmpRoot)).toBe(false);
    getDb();
    expect(existsSync(paths.db)).toBe(true);
  });

  test("running lazy migrations gives the new DB its schema", () => {
    const db = getDb();
    // session_aliases arrives in migration 0017 — querying it should
    // succeed (returning [] on a fresh DB), not throw.
    const result = db.$client.prepare("SELECT count(*) as n FROM session_aliases").get();
    expect(result).toEqual({ n: 0 });
  });

  test("the derived grouping columns and their indexes land on a fresh DB", () => {
    // 0019 is the grouping teardown's migration. A missing column here fails
    // only at runtime — the schema types would still compile — so the shape is
    // asserted against the actual file.
    const db = getDb();
    const columns = (
      db.$client.prepare("SELECT name FROM pragma_table_info('sessions')").all() as Array<{
        name: string;
      }>
    ).map((c) => c.name);
    expect(columns).toContain("worktree_root");
    expect(columns).toContain("main_checkout");
    expect(columns).toContain("repo");
    expect(columns).toContain("group_key");

    const indexes = (
      db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='sessions'")
        .all() as Array<{ name: string }>
    ).map((i) => i.name);
    expect(indexes).toContain("sessions_group_key");
    expect(indexes).toContain("sessions_repo");
  });

  test("re-opens when the root moves, rather than serving the old file", () => {
    // The cache is keyed on the resolved path because `paths.db` is an
    // accessor now: a cache that only remembered "something is open" would go
    // on writing to the previous file after the root moved.
    const first = getDb();
    const moved = join(dirname(tmpRoot), "moved-home");
    _setRootDir(moved);

    const second = getDb();

    expect(second).not.toBe(first);
    expect(existsSync(join(moved, "bertrand.db"))).toBe(true);
  });
});

describe("openDb migration recovery", () => {
  test("rebuilds schema when __drizzle_migrations is populated but tables are missing", () => {
    // Reproduces the production hook-subprocess race: __drizzle_migrations
    // ended up populated with the correct hashes but the actual schema
    // tables never landed. drizzle's migrate() looks at hashes, sees a
    // match, and silently skips — so openDb must verify the schema is
    // actually present and re-migrate if not.
    const realPath = join(dirname(tmpRoot), "tmp-real", "real.db");
    mkdirSync(dirname(realPath), { recursive: true });
    const real = new Database(realPath);
    migrate(drizzle(real), { migrationsFolder: MIGRATIONS_FOLDER });
    const realHashes = real
      .query("SELECT hash, created_at FROM __drizzle_migrations ORDER BY id")
      .all() as Array<{ hash: string; created_at: number }>;
    real.close();

    mkdirSync(tmpRoot, { recursive: true });
    const sqlite = new Database(paths.db);
    sqlite.exec(
      "CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)",
    );
    const stmt = sqlite.prepare(
      "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
    );
    for (const r of realHashes) stmt.run(r.hash, r.created_at);
    sqlite.close();

    const db = getDb();
    const result = db.$client.prepare("SELECT count(*) as n FROM sessions").get();
    expect(result).toEqual({ n: 0 });
  });
});

describe("invalidateDbCache", () => {
  test("forces a fresh open on the next call", () => {
    const first = getDb();

    invalidateDbCache();

    expect(getDb()).not.toBe(first);
  });

  test("leaves the underlying connection open — it forgets, it does not close", () => {
    const db = getDb();

    invalidateDbCache();

    // Forgetting a handle is not releasing it: the descriptor stays open, so
    // a query already in flight through the old handle keeps working. Closing
    // here instead would yank the connection out from under it.
    expect(() => db.$client.prepare("SELECT 1").get()).not.toThrow();
  });
});
