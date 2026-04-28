import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { paths } from "@/lib/paths";

mkdirSync(dirname(paths.db), { recursive: true });
const sqlite = new Database(paths.db);
sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec("PRAGMA foreign_keys = ON");

const db = drizzle(sqlite);
migrate(db, { migrationsFolder: import.meta.dir + "/migrations" });

console.log("Migrations applied successfully");
sqlite.close();
