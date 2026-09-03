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
import { isProcessAlive } from "@/lib/process-identity";

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
 * `autocreate-$cid` is the gate in front of *automatic* adoption (ELKY-175),
 * and it is a three-state file read entirely with bash builtins: absent means
 * this conversation has submitted no prompt yet, present-and-empty means it
 * has submitted exactly one (the materiality gate — one prompt is not yet work
 * worth recording), and non-empty means auto-adoption has already declined for
 * a reason that will not change. See {@link markAutoCreateDeclined}.
 *
 * Two cleanup paths cover both cases:
 *   - pruneSessionMarkers: immediate, happy-path cleanup keyed to the session
 *     and conversation bertrand owns. Adopted sessions reach it too, since
 *     session recovery finalizes them once claude exits (ELKY-183).
 *   - pruneStaleMarkers: an mtime sweep that catches orphans left by sessions
 *     bertrand never finalized.
 */

const CONTRACT_MARKER_PREFIX = "contract-sent-";
const ADOPTION_MARKER_PREFIX = "adopted-";
const AUTO_CREATE_MARKER_PREFIX = "autocreate-";

/** Default age past which an orphaned contract-sent marker is swept. */
const STALE_MS = 24 * 60 * 60 * 1000;

// Indirection over paths.runtime so tests can point the marker dir at a temp
// location. Narrower than `_setRootDir` in lib/paths on purpose: a test of the
// markers alone should not have to relocate the database to get one.
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
  if (conversationId) {
    rmMarker(`${CONTRACT_MARKER_PREFIX}${conversationId}`);
    // Dropped along with the adoption marker so a `claude --resume` of this
    // conversation re-arms the same way a fresh one does: one prompt to prove
    // materiality, then a re-attach. Left behind, an already-declined gate
    // would keep a resumed session unrecorded forever.
    rmMarker(`${AUTO_CREATE_MARKER_PREFIX}${conversationId}`);
    // The session this marker points at has just been finalized, so leaving it
    // would let a `claude --resume` of the same conversation keep writing
    // events onto a row that already has an endedAt and materialized stats.
    // Re-running `adopt` re-attaches and rewrites it.
    rmMarker(`${ADOPTION_MARKER_PREFIX}${conversationId}`);
  }
}

/**
 * Sweep orphaned `contract-sent-*`, `adopted-*` and `autocreate-*` markers
 * older than `maxAgeMs`. The backstop for markers whose session bertrand never finalized;
 * the happy path is pruneSessionMarkers. Safe to call on every launch — it
 * touches only those three prefixes and tolerates a missing runtime dir.
 *
 * Age alone can't decide an adoption marker's fate. A contract marker has done
 * its job the moment the conversation moves on, but an adopted claude can sit
 * open for days, and sweeping its marker would silently stop recording a
 * session the user is still in — a worse failure than the stale file. So the
 * marker carries claude's pid, and a live pid vetoes the sweep outright.
 */
export function pruneStaleMarkers(maxAgeMs: number = STALE_MS): void {
  let entries: string[];
  try {
    entries = readdirSync(runtimeDir);
  } catch {
    return; // runtime dir not created yet — nothing to sweep
  }

  const cutoff = Date.now() - maxAgeMs;
  for (const name of entries) {
    const isContract = name.startsWith(CONTRACT_MARKER_PREFIX);
    const isAdoption = name.startsWith(ADOPTION_MARKER_PREFIX);
    // Swept on age like a contract marker rather than on liveness like an
    // adoption one. It holds no session state — only "we already decided" —
    // so the worst a premature sweep costs is one more `auto-adopt` spawn that
    // reaches the same conclusion.
    const isAutoCreate = name.startsWith(AUTO_CREATE_MARKER_PREFIX);
    if (!isContract && !isAdoption && !isAutoCreate) continue;

    if (isAdoption) {
      // Liveness only, no identity check: a recycled pid at worst keeps a dead
      // marker around one more sweep, while treating a live claude as dead
      // un-tracks a session in progress.
      const pid = readAdoptionMarker(name.slice(ADOPTION_MARKER_PREFIX.length))?.pid;
      if (pid != null && isProcessAlive(pid)) continue;
    }

    try {
      if (statSync(join(runtimeDir, name)).mtimeMs < cutoff) rmMarker(name);
    } catch {
      // Raced with another process removing it — fine.
    }
  }
}

/**
 * What an `adopted-$cid` marker resolves a claude session to.
 *
 * One field of substance, where there used to be two: the marker also carried
 * the project slug whose DB held the session, so a hook tick could export
 * `BERTRAND_PROJECT` and write to the right file. There is one database now
 * (`paths.db`), so there is no choice left to record.
 */
export interface AdoptionMarker {
  /** bertrand session id the claude session was adopted into. */
  sessionId: string;
  /**
   * Claude's pid, when adoption could determine it. Read only by the stale
   * sweep, which uses it to leave a still-running session's marker alone; the
   * hook guards ignore the field entirely.
   */
  pid?: number;
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
 * Path of the gate that decides whether automatic adoption may run for this
 * claude session. Keyed by claude's own session id, like the adoption marker,
 * because the hook that reads it has that id in its environment and nothing
 * else to key on.
 */
export function autoCreateGatePath(claudeSessionId: string): string {
  return join(runtimeDir, `${AUTO_CREATE_MARKER_PREFIX}${claudeSessionId}`);
}

/**
 * Record that automatic adoption has declined this conversation for good.
 *
 * Content over existence: the hook already writes this file *empty* on the
 * first user prompt to arm the materiality gate, so "we decided no" has to be
 * distinguishable from "we've seen one prompt". Non-empty is that signal, and
 * it costs the hook a `[ -s ]` — a bash builtin — rather than a `grep`.
 *
 * The reason is written for the human debugging why a session never appeared;
 * nothing parses it.
 */
export function markAutoCreateDeclined(
  claudeSessionId: string,
  reason: string,
): void {
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(autoCreateGatePath(claudeSessionId), `declined=${reason}\n`);
}

/**
 * Write the adoption marker.
 *
 * `key=value` lines rather than JSON because the readers are the six bash hook
 * guards on Claude's hot path: they have to resolve a session with grep and
 * cut, never jq (~1ms vs ~15ms, paid by every claude on the machine).
 */
export function writeAdoptionMarker(
  claudeSessionId: string,
  marker: AdoptionMarker,
): void {
  mkdirSync(runtimeDir, { recursive: true });
  const lines = [`session=${marker.sessionId}`];
  // Omitted rather than written empty when unknown: the sweep distinguishes
  // "claude is alive" from "we can't tell", and an empty value reads as the
  // latter either way, but a missing key says so without parsing.
  if (marker.pid != null) lines.push(`pid=${marker.pid}`);
  writeFileSync(adoptionMarkerPath(claudeSessionId), `${lines.join("\n")}\n`);
}

/**
 * Read an adoption marker, or null when there is none (the overwhelmingly
 * common case — most claudes on the machine are not adopted). A marker with
 * no `session=` line is treated as absent rather than half-trusted: it is a
 * torn write, and there is nothing in it to resolve.
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
  if (!sessionId) return null;

  // `> 0` matters: `kill(0, 0)` targets the caller's whole process group and
  // always succeeds, so a `pid=0` marker would read as permanently alive and
  // never be swept.
  const rawPid = Number(fields.get("pid"));
  const pid = Number.isInteger(rawPid) && rawPid > 0 ? rawPid : undefined;
  return { sessionId, ...(pid == null ? {} : { pid }) };
}
