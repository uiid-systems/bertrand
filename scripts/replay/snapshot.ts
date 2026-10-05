import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * A bertrand home as it stood at `asOf`, for one replayed task.
 *
 * The replay's agent can run `bertrand log` itself, and against the live
 * database that shows the task's own future — often its answer. So each task
 * gets a copy cut at the moment it was originally asked, and the runner puts a
 * `bertrand` on the agent's PATH that reads it.
 *
 * `julianday()` on both sides because stored times mix sqlite
 * (`2026-10-02 17:43:29`) and ISO (`2026-10-02T17:43:29.123Z`), which don't
 * compare as strings.
 */
export function cutSnapshot(sourceDb: string, home: string, asOf: string): string {
  const dir = join(home, ".bertrand");
  mkdirSync(join(dir, "run"), { recursive: true });
  const db = join(dir, "bertrand.db");

  const source = new Database(sourceDb, { readonly: true });
  try {
    source.exec(`VACUUM INTO '${db.replaceAll("'", "''")}'`);
  } finally {
    source.close();
  }

  const cut = new Database(db);
  try {
    cut.exec("PRAGMA foreign_keys = ON");
    // `asOf` is the moment the task was asked, which is usually the instant
    // its own conversation (and maybe session) started. So rows that *start*
    // at it survive — the replay needs them to exist — while events at it go:
    // the first is the task's own prompt, which the runner supplies.
    const atOrAfter = (column: string) => `julianday(${column}) >= julianday($asOf)`;
    const after = (column: string) => `julianday(${column}) > julianday($asOf)`;
    cut.transaction(() => {
      const run = (sql: string) => cut.query(sql).run({ $asOf: asOf });
      // Events first: they reference conversations without a cascade.
      run(`DELETE FROM events WHERE ${atOrAfter("created_at")}
             OR conversation_id IN (SELECT id FROM conversations WHERE ${after("started_at")})`);
      run(`DELETE FROM conversations WHERE ${after("started_at")}`);
      run(`DELETE FROM sessions WHERE ${after("started_at")}`); // cascades the rest
    })();
    // Written at the latest pause or tick, so later than the cut by
    // construction. Summaries re-derive from the surviving events on demand.
    cut.exec("UPDATE sessions SET summary = NULL");
    cut.exec("DELETE FROM session_stats");
  } finally {
    cut.close();
  }

  // Config without sync: a replay must never push or pull.
  const config = join(process.env.HOME ?? "", ".bertrand", "config.json");
  const settings = existsSync(config) ? JSON.parse(readFileSync(config, "utf-8")) : {};
  delete settings.sync;
  writeFileSync(join(dir, "config.json"), JSON.stringify(settings, null, 2) + "\n");

  return db;
}

/** A `bertrand` that reads the snapshot, for the front of the agent's PATH. */
export function writeBertrandShim(binDir: string, home: string, bertrand: string[]): void {
  mkdirSync(binDir, { recursive: true });
  const quoted = bertrand.map((a) => `'${a.replaceAll("'", `'\\''`)}'`).join(" ");
  const shim = join(binDir, "bertrand");
  writeFileSync(shim, `#!/bin/sh\nHOME='${home}' exec ${quoted} "$@"\n`, { mode: 0o755 });
}
