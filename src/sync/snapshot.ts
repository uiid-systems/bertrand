import { Database } from "bun:sqlite";
import { existsSync, unlinkSync } from "fs";
import { resolveActiveProject } from "@/lib/projects/resolve";

/**
 * Sidecar files SQLite creates alongside a database in WAL mode. We delete
 * all of them when cleaning up the snapshot so a stale leftover doesn't
 * trip the next snapshot.
 */
const SIDECAR_SUFFIXES = ["", "-wal", "-shm"] as const;

function snapshotPathFor(dbPath: string): string {
  return `${dbPath}.sync-snapshot`;
}

/**
 * Produce a lock-free, internally-consistent copy of the active project's
 * live database. Uses SQLite's `VACUUM INTO`, which is safe to run while
 * other processes (the API server, the TUI) hold the source DB open in
 * WAL mode. The destination file is created fresh — any prior snapshot
 * and its sidecars are removed first so the sync engine starts clean.
 */
export function takeSnapshot(): string {
  cleanupSnapshot();
  const dbPath = resolveActiveProject().db;
  const target = snapshotPathFor(dbPath);
  const src = new Database(dbPath, { readonly: true });
  try {
    src.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } finally {
    src.close();
  }
  return target;
}

export function cleanupSnapshot(): void {
  const base = snapshotPathFor(resolveActiveProject().db);
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
