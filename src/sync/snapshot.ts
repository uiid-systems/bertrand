import { Database } from "bun:sqlite";
import { existsSync, unlinkSync } from "fs";
import { paths } from "@/lib/paths";

/**
 * Sidecar files SQLite creates alongside a database in WAL mode. We delete
 * all of them when cleaning up the snapshot so a stale leftover doesn't
 * trip the next snapshot.
 */
const SIDECAR_SUFFIXES = ["", "-wal", "-shm"] as const;

export const SNAPSHOT_PATH = `${paths.db}.sync-snapshot`;

/**
 * Produce a lock-free, internally-consistent copy of the live database at
 * SNAPSHOT_PATH. Uses SQLite's `VACUUM INTO`, which is safe to run while
 * other processes (the API server, the TUI) hold the source DB open in
 * WAL mode. The destination file is created fresh — any prior snapshot
 * and its sidecars are removed first so the sync engine starts clean.
 */
export function takeSnapshot(): string {
  cleanupSnapshot();
  const src = new Database(paths.db, { readonly: true });
  try {
    src.exec(`VACUUM INTO '${SNAPSHOT_PATH.replace(/'/g, "''")}'`);
  } finally {
    src.close();
  }
  return SNAPSHOT_PATH;
}

export function cleanupSnapshot(): void {
  for (const suffix of SIDECAR_SUFFIXES) {
    const p = SNAPSHOT_PATH + suffix;
    if (existsSync(p)) {
      try {
        unlinkSync(p);
      } catch {
        // Ignore — leftover sidecars are non-fatal; next run will retry.
      }
    }
  }
}
