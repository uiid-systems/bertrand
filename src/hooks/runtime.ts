import { readdirSync, rmSync, statSync } from "fs";
import { join } from "path";
import { paths } from "@/lib/paths";

/**
 * Runtime-marker housekeeping.
 *
 * Hook scripts drop short-lived marker files in `paths.runtime`: per-session
 * state (`done-$sid`, `auq-nudge-$sid`, `working-$sid`, `worktree-$sid`) and per-conversation
 * state (`contract-sent-$cid`). The per-session markers are cleared along their
 * normal control flow, but `contract-sent-$cid` is intentionally write-once and
 * never removed by a hook — and sessions that bertrand didn't spawn (background
 * jobs, an external launcher) never reach finalizeSession, so their markers would
 * otherwise accumulate forever.
 *
 * Two cleanup paths cover both cases:
 *   - pruneSessionMarkers: immediate, happy-path cleanup keyed to the session
 *     and conversation bertrand owns.
 *   - pruneStaleContractMarkers: an mtime sweep that catches orphans left by
 *     sessions bertrand never finalized.
 */

const CONTRACT_MARKER_PREFIX = "contract-sent-";

/** Default age past which an orphaned contract-sent marker is swept. */
const STALE_MS = 24 * 60 * 60 * 1000;

// Indirection over paths.runtime so tests can point the marker dir at a temp
// location. Mirrors the _setRegistryDir seam in lib/projects/registry.
let runtimeDir = paths.runtime;
export function _setRuntimeDir(dir: string): void {
  runtimeDir = dir;
}
export function _getRuntimeDir(): string {
  return runtimeDir;
}

function rmMarker(name: string): void {
  rmSync(join(runtimeDir, name), { force: true });
}

/**
 * Remove the markers owned by a finished session/conversation. Best-effort —
 * a missing file is a no-op, and a missing runtime dir is ignored.
 */
export function pruneSessionMarkers(
  sessionId: string,
  conversationId?: string,
): void {
  rmMarker(`done-${sessionId}`);
  rmMarker(`auq-nudge-${sessionId}`);
  rmMarker(`working-${sessionId}`);
  rmMarker(`worktree-${sessionId}`);
  if (conversationId) rmMarker(`${CONTRACT_MARKER_PREFIX}${conversationId}`);
}

/**
 * Sweep `contract-sent-*` markers older than `maxAgeMs`. Catches markers left
 * by sessions bertrand never spawned (and therefore never finalized). Safe to
 * call on every launch — it only touches contract-sent markers and tolerates a
 * missing runtime dir.
 */
export function pruneStaleContractMarkers(maxAgeMs: number = STALE_MS): void {
  let entries: string[];
  try {
    entries = readdirSync(runtimeDir);
  } catch {
    return; // runtime dir not created yet — nothing to sweep
  }

  const cutoff = Date.now() - maxAgeMs;
  for (const name of entries) {
    if (!name.startsWith(CONTRACT_MARKER_PREFIX)) continue;
    try {
      if (statSync(join(runtimeDir, name)).mtimeMs < cutoff) rmMarker(name);
    } catch {
      // Raced with another process removing it — fine.
    }
  }
}
