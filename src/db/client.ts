import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { paths } from "@/lib/paths";
import * as schema from "./schema";

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

const MIGRATIONS_FOLDER = import.meta.dir + "/migrations";

/**
 * The one database handle for this process.
 *
 * There used to be a `Map` of them, keyed by SQLite path, because a project
 * owned a database and a process could touch several. Grouping is now a column
 * derived from the session's cwd (`sessions.group_key`, from
 * `@/lib/session-key`), so there is exactly one file to open and the cache is a
 * variable rather than a map. That collapse is what removes the cross-DB fan-out
 * that used to sit behind every question spanning more than one group — `adopt`
 * had to open every project's DB in turn just to ask "do I already know this
 * conversation?".
 */
let _db: DrizzleDb | null = null;

/**
 * The path {@link _db} was opened at, and the path the migrator has already
 * run against. One value each instead of the old `Set` of migrated paths — but
 * still a *path* rather than a boolean, because `paths.db` is now an accessor
 * that `_setRootDir` can repoint mid-process. A cache that only remembered
 * "something is open" would go on serving the previous file after a test moved
 * bertrand's home, which is exactly the silent wrong-file write the
 * per-project layout used to produce.
 */
let _dbPath: string | null = null;
let _migratedPath: string | null = null;

/**
 * Test override. When set, every call to `getDb()` returns this instance
 * instead of consulting the cache. Tests use this to inject a tmpfile-backed
 * drizzle handle without going anywhere near the real database.
 */
let _testDb: DrizzleDb | null = null;

/**
 * Open or return the cached drizzle handle for bertrand's database. Test
 * override via `_setDb()` short-circuits the open entirely.
 */
export function getDb(): DrizzleDb {
  if (_testDb) return _testDb;
  return openDb(paths.db);
}

/**
 * Forget the cached handle, so the next `getDb()` opens the file again. Long
 * running processes (the dashboard server) call this when they need to be sure
 * they are not serving a stale connection.
 *
 * Note: this does NOT close the underlying sqlite connection — that's by
 * design. The connection closes when garbage collected or when the process
 * exits; closing here could yank a handle still held by an in-flight query.
 */
export function invalidateDbCache(): void {
  _db = null;
  _dbPath = null;
  _migratedPath = null;
}

function openDb(dbPath: string): DrizzleDb {
  if (_db && _dbPath === dbPath) return _db;

  mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  // busy_timeout MUST go first so the rest of the PRAGMAs and the lazy
  // migration below wait on a concurrent writer instead of failing with
  // SQLITE_BUSY. Hook subprocesses race on this regularly (every PreToolUse
  // spawns a fresh bertrand process); 5s is generous for our workload.
  sqlite.exec("PRAGMA busy_timeout = 5000");
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec("PRAGMA synchronous = NORMAL");
  sqlite.exec("PRAGMA cache_size = -8000");
  sqlite.exec("PRAGMA temp_store = MEMORY");

  const db = drizzle(sqlite, { schema });

  // Lazy-migrate once per process. The migrator is idempotent (checks
  // `__drizzle_migrations`) so this is a no-op against a DB that is already
  // current, and applies the full sequence for a fresh install. Skipping it
  // would leave a first run schema-less, so this is load-bearing rather than
  // convenience.
  //
  // After migration, verify the `sessions` table actually exists. We've
  // seen cases where two processes race on a fresh DB and one ends up with
  // `__drizzle_migrations` populated but real tables missing — that's the
  // "no such table: sessions" panic the hooks were leaking. If we observe
  // it, drop `__drizzle_migrations` and re-run so the schema lands.
  //
  // Close the sqlite handle on migration failure so a transient error
  // (corrupt `__drizzle_migrations`, partial schema, etc.) doesn't leak
  // file descriptors across retries. The cache and `_migratedPath` stay
  // unchanged so the next call will retry the open from scratch.
  if (_migratedPath !== dbPath) {
    try {
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      if (!hasSessionsTable(sqlite)) {
        sqlite.exec("DROP TABLE IF EXISTS __drizzle_migrations");
        migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      }
    } catch (err) {
      sqlite.close();
      throw err;
    }
    _migratedPath = dbPath;
  }

  _db = db;
  _dbPath = dbPath;
  return db;
}

function hasSessionsTable(sqlite: Database): boolean {
  const row = sqlite
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'")
    .get();
  return row !== null;
}

/** Replace the singleton — for tests only. */
export function _setDb(db: DrizzleDb): void {
  _testDb = db;
}

/** Clear the test override and the cached handle — for tests only. */
export function _clearTestDb(): void {
  _testDb = null;
  invalidateDbCache();
}

export type Db = DrizzleDb;
