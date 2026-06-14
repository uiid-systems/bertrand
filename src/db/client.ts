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
    return;
  }
  const dbPath = projectPaths(slug).db;
  _cache.delete(dbPath);
  _migrated.delete(dbPath);
}

function openDb(dbPath: string): DrizzleDb {
  const cached = _cache.get(dbPath);
  if (cached) return cached;

  mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
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
  if (!_migrated.has(dbPath)) {
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    _migrated.add(dbPath);
  }

  _cache.set(dbPath, db);
  return db;
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
}

export type Db = DrizzleDb;
