import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { paths } from "@/lib/paths";
import * as schema from "./schema";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (_db) return _db;

  mkdirSync(dirname(paths.db), { recursive: true });
  const sqlite = new Database(paths.db);
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec("PRAGMA synchronous = NORMAL");
  sqlite.exec("PRAGMA cache_size = -8000");
  sqlite.exec("PRAGMA temp_store = MEMORY");

  _db = drizzle(sqlite, { schema });
  return _db;
}

/** Replace the singleton — for tests only */
export function _setDb(db: ReturnType<typeof drizzle<typeof schema>>) {
  _db = db;
}

export type Db = ReturnType<typeof getDb>;
