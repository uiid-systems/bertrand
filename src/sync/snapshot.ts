import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import { paths } from "@/lib/paths";

/**
 * Sidecar files SQLite creates alongside a database in WAL mode. We delete
 * all of them when cleaning up the snapshot so a stale leftover doesn't
 * trip the next snapshot.
 */
const SIDECAR_SUFFIXES = ["", "-wal", "-shm"] as const;

/**
 * Where the snapshot lands: `~/.bertrand/snapshots/bertrand.db`.
 *
 * A directory of its own rather than `bertrand.db.sync-snapshot` beside the
 * live file. `paths.snapshots` existed for this and went unused while sync was
 * per-project; using it keeps `~/.bertrand` free of files that look like a
 * database and aren't, which matters because the recovery scan treats a stray
 * `bertrand.db` as a real one.
 */
function snapshotPath(): string {
  return join(paths.snapshots, "bertrand.db");
}

/**
 * Produce a lock-free, internally-consistent copy of the live database. Uses
 * SQLite's `VACUUM INTO`, which is safe to run while other processes (the API
 * server, the TUI) hold the source DB open in WAL mode. The destination file
 * is created fresh — any prior snapshot and its sidecars are removed first so
 * the sync engine starts clean.
 */
export function takeSnapshot(): string {
  cleanupSnapshot();
  mkdirSync(paths.snapshots, { recursive: true });
  const target = snapshotPath();
  const src = new Database(paths.db, { readonly: true });
  try {
    src.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } finally {
    src.close();
  }
  return target;
}

export function cleanupSnapshot(): void {
  const base = snapshotPath();
  for (const suffix of SIDECAR_SUFFIXES) {
    const p = base + suffix;
    if (existsSync(p)) {
      try {
        unlinkSync(p);
      } catch {
        // Ignore — leftover sidecars are non-fatal; next run will retry.
      }
    }
  }
}
