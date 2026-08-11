import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { resolveActiveProject } from "@/lib/projects/resolve";
import { projectPaths } from "@/lib/projects/paths";
import * as schema from "./schema";

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

const MIGRATIONS_FOLDER = import.meta.dir + "/migrations";

/**
 * Per-project DB cache. Keyed by the absolute path of the SQLite file so the
 * same project resolves to the same handle no matter how it's looked up
 * (`getDb()` via the active resolver, or `getDbForProject(slug)` directly).
 */
const _cache = new Map<string, DrizzleDb>();
const _migrated = new Set<string>();

/**
 * The raw sqlite handles behind the drizzle wrappers in `_cache`, keyed the
 * same way. Tracked separately because drizzle doesn't expose the underlying
 * `Database`, and reaching it is the only way to actually close a connection
 * (see {@link closeDbForProject}).
 */
const _handles = new Map<string, Database>();

/**
 * Test override. When set, every call to `getDb()` / `getDbForProject()`
 * returns this instance instead of consulting the cache. Tests use this to
 * inject a tmpfile-backed drizzle handle without touching the filesystem
 * resolver chain.
 */
let _testDb: DrizzleDb | null = null;

/**
 * Open or return the cached drizzle handle for the *active* project (env
 * var → registry → "default", per `resolveActiveProject`). Test override
 * via `_setDb()` short-circuits the resolver.
 */
export function getDb(): DrizzleDb {
  if (_testDb) return _testDb;
  return openDb(resolveActiveProject().db);
}

/**
 * Open or return the cached drizzle handle for a *specific* project slug.
 * Used for cross-project operations like `bertrand sync --project foo` or
 * cleanup during `project remove`. Most code should stay on `getDb()` so
 * project resolution stays centralized.
 */
export function getDbForProject(slug: string): DrizzleDb {
  if (_testDb) return _testDb;
  return openDb(projectPaths(slug).db);
}

/**
 * Drop cached handles. Called when a project is deleted or when long-running
 * processes (the dashboard server) need to force re-resolution. Without a
 * slug, clears every cached handle.
 *
 * Note: this does NOT close the underlying sqlite connections — that's by
 * design. Connections close when garbage collected or when the process
 * exits; closing here could yank a handle still held by an in-flight query.
 */
export function invalidateDbCache(slug?: string): void {
  if (!slug) {
    _cache.clear();
    _migrated.clear();
    _handles.clear();
    return;
  }
  const dbPath = projectPaths(slug).db;
  _cache.delete(dbPath);
  _migrated.delete(dbPath);
  _handles.delete(dbPath);
}

/**
 * Close the sqlite connection for a project and drop its cache entries.
 *
 * The distinction from {@link invalidateDbCache} is the whole point: forgetting
 * a handle is not enough to release the files behind it. Unix keeps a deleted
 * file's inode — and its disk space — alive until the last descriptor on it
 * closes, so a long-lived `bertrand serve` that merely dropped its cache entry
 * would go on pinning a purged project's `bertrand.db`, `-wal` and `-shm`
 * indefinitely. `project remove --purge` reported success while reclaiming
 * nothing (issue #249).
 *
 * Only call this for a project that is gone from the registry. That precondition
 * is what makes an unconditional close safe: nothing can legitimately resolve or
 * query the project again, so there is no handle worth preserving. Bun's
 * `close()` maps to `sqlite3_close_v2`, so a statement still in flight finishes
 * and the connection frees itself afterwards rather than erroring mid-query.
 *
 * Returns whether this process actually had a connection open — `false` simply
 * means there was nothing to release.
 */
export function closeDbForProject(slug: string): boolean {
  const dbPath = projectPaths(slug).db;
  const handle = _handles.get(dbPath);

  _cache.delete(dbPath);
  _migrated.delete(dbPath);
  _handles.delete(dbPath);

  if (!handle) return false;
  handle.close();
  return true;
}

function openDb(dbPath: string): DrizzleDb {
  const cached = _cache.get(dbPath);
  if (cached) return cached;

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

  // Lazy-migrate once per dbPath per process. The migrator is idempotent
  // (checks `__drizzle_migrations`) so this is a no-op against a DB that
  // is already current, and applies the full sequence for a fresh project.
  // Skipping migration on a fresh per-project DB would leave it schema-less,
  // so this is load-bearing rather than convenience.
  //
  // After migration, verify the `sessions` table actually exists. We've
  // seen cases where two processes race on a fresh DB and one ends up with
  // `__drizzle_migrations` populated but real tables missing — that's the
  // "no such table: sessions" panic the hooks were leaking. If we observe
  // it, drop `__drizzle_migrations` and re-run so the schema lands.
  //
  // Close the sqlite handle on migration failure so a transient error
  // (corrupt `__drizzle_migrations`, partial schema, etc.) doesn't leak
  // file descriptors across retries. The cache + _migrated set stay
  // unchanged so the next call will retry the open from scratch.
  if (!_migrated.has(dbPath)) {
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
    _migrated.add(dbPath);
  }

  _cache.set(dbPath, db);
  _handles.set(dbPath, sqlite);
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

/** Clear the test override and per-path cache — for tests only. */
export function _clearTestDb(): void {
  _testDb = null;
  _cache.clear();
  _migrated.clear();
  _handles.clear();
}

export type Db = DrizzleDb;
