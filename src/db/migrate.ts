import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { paths } from "@/lib/paths";

const MIGRATIONS_FOLDER = import.meta.dir + "/migrations";

/**
 * Apply all pending Drizzle migrations to bertrand's database.
 *
 * Defaults to `paths.db`, which is the only database there is — the per-project
 * fan-out this used to walk went away with the project registry, so there is no
 * "non-active project" left to target. `dbPath` survives for the one caller
 * shape that still needs it: pointing the migrator at a copy (a scratch probe,
 * a snapshot being verified) without touching the live file.
 *
 * Idempotent: re-running against a current DB is a no-op via
 * `__drizzle_migrations`. The connection is opened, used, and closed —
 * this is the explicit one-shot path, not the lazy path inside
 * `db/client.ts` that piggybacks on the cached handle.
 */
export function runMigrations(dbPath?: string): void {
  const target = dbPath ?? paths.db;
  mkdirSync(dirname(target), { recursive: true });
  const sqlite = new Database(target);
  // busy_timeout first so the migrator waits on a concurrent writer instead
  // of failing with SQLITE_BUSY. Mirrors the one in db/client.ts.
  sqlite.exec("PRAGMA busy_timeout = 5000");
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  sqlite.close();
}

if (import.meta.main) {
  runMigrations();
  console.log("Migrations applied successfully");
}
