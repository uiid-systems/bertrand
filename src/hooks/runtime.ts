import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
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
 * `adopted-$cid` is the one marker a hook only ever *reads*. `bertrand adopt`
 * writes it (ELKY-179) so a claude bertrand never spawned can still be resolved
 * to a session: the hook guards fall back to it when `BERTRAND_SESSION` is
 * absent from their env, keying off the `session_id` in their own payload.
 *
 * Two cleanup paths cover both cases:
 *   - pruneSessionMarkers: immediate, happy-path cleanup keyed to the session
 *     and conversation bertrand owns.
 *   - pruneStaleContractMarkers: an mtime sweep that catches orphans left by
 *     sessions bertrand never finalized.
 */

const CONTRACT_MARKER_PREFIX = "contract-sent-";
const ADOPTION_MARKER_PREFIX = "adopted-";

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
 * Path of the once-per-conversation marker that downgrades contract delivery
 * from the full text to a one-line reminder. Keyed by conversation id, falling
 * back to the session id for a session with no conversation of its own —
 * exactly the `${cid:-$sid}` the UserPromptSubmit hook builds.
 */
export function contractMarkerPath(conversationId: string): string {
  return join(runtimeDir, `${CONTRACT_MARKER_PREFIX}${conversationId}`);
}

/**
 * Record that the full contract has been delivered for this conversation.
 *
 * Normally the UserPromptSubmit hook writes this as it prints the contract.
 * The `/bertrand` command has to print the contract itself — an adopted
 * session's first user interaction is often an AskUserQuestion answer, which
 * is a tool result and fires no UserPromptSubmit — so it marks it here
 * instead, and the hook correctly degrades to the reminder from then on.
 */
export function markContractSent(conversationId: string): void {
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(contractMarkerPath(conversationId), "");
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

/** What an `adopted-$cid` marker resolves a claude session to. */
export interface AdoptionMarker {
  /** bertrand session id the claude session was adopted into. */
  sessionId: string;
  /** Project slug whose DB holds that session. */
  project: string;
}

/**
 * Path of the marker that makes an externally-launched claude session visible
 * to bertrand. Keyed by claude's own session id — the value the hook payload
 * carries as `session_id`, which is also `CLAUDE_CODE_SESSION_ID` and the
 * transcript filename (all three proved identical in the ELKY-179 spike).
 */
export function adoptionMarkerPath(claudeSessionId: string): string {
  return join(runtimeDir, `${ADOPTION_MARKER_PREFIX}${claudeSessionId}`);
}

/**
 * Write the adoption marker.
 *
 * `key=value` lines rather than JSON because the readers are the six bash hook
 * guards on Claude's hot path: they have to resolve a session with grep and
 * cut, never jq (~1ms vs ~15ms, paid by every claude on the machine).
 *
 * `project` rides along because an adopted claude was spawned by something
 * other than bertrand and so never inherited `BERTRAND_PROJECT`. Without it
 * the hook would write into whichever project happens to be active in the
 * registry when it fires, which has no relation to the session it just found.
 */
export function writeAdoptionMarker(
  claudeSessionId: string,
  marker: AdoptionMarker,
): void {
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    adoptionMarkerPath(claudeSessionId),
    `session=${marker.sessionId}\nproject=${marker.project}\n`,
  );
}

/**
 * Read an adoption marker, or null when there is none (the overwhelmingly
 * common case — most claudes on the machine are not adopted). A marker
 * missing either field is treated as absent rather than half-trusted: a
 * partial write would otherwise resolve a session into the wrong project.
 */
export function readAdoptionMarker(
  claudeSessionId: string,
): AdoptionMarker | null {
  let contents: string;
  try {
    contents = readFileSync(adoptionMarkerPath(claudeSessionId), "utf8");
  } catch {
    return null;
  }

  const fields = new Map<string, string>();
  for (const line of contents.split("\n")) {
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    fields.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }

  const sessionId = fields.get("session");
  const project = fields.get("project");
  if (!sessionId || !project) return null;
  return { sessionId, project };
}
