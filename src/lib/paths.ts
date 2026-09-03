import { homedir } from "os";
import { join } from "path";

const BERTRAND_DIR = ".bertrand";

let _rootOverride: string | null = null;

/**
 * Redirect every path below — for tests only.
 *
 * This knob used to live in the project registry as `_setRegistryDir`, which
 * is where it accidentally acquired its reach: `projectPaths(slug)` was a
 * *function* that consulted it, so a test could redirect a project's DB, while
 * the paths on this module were plain string constants evaluated at import and
 * could not be redirected at all. Collapsing to one database moved the DB path
 * here, so the knob had to come too — and the accessors below mean it now
 * covers every path bertrand owns rather than only the ones that happened to
 * be computed lazily.
 *
 * Pass null to restore the real home directory.
 */
export function _setRootDir(dir: string | null): void {
  _rootOverride = dir;
}

/** The bertrand home directory, honouring the test override. */
export function _getRootDir(): string {
  return _rootOverride ?? join(homedir(), BERTRAND_DIR);
}

/**
 * Every path bertrand owns.
 *
 * There is one database and one sync config again. They were split per-project
 * when a project was the grouping dimension, and that dimension is gone:
 * sessions group by a key derived from their cwd (`@/lib/session-key`), which
 * is a column, not a file layout. A per-project file tree bought nothing once
 * the group stopped being a registry row, and cost a cross-DB scan on every
 * lookup that spanned one — `adopt`'s conversation dedupe had to open every
 * project's DB in turn to answer "do I already know this conversation?".
 *
 * Every entry is an accessor rather than a stored string so that
 * {@link _setRootDir} reaches all of them. Read them as properties; the getters
 * are an implementation detail.
 */
export const paths = {
  get root() {
    return _getRootDir();
  },
  get hooks() {
    return join(_getRootDir(), "hooks");
  },
  get sessions() {
    return join(_getRootDir(), "sessions");
  },
  /**
   * Per-install runtime scratch dir for short-lived markers (debounce,
   * permission-pending). Lived under /tmp historically; moved here because
   * /tmp on macOS survives reboots, so stale markers from a previous
   * bertrand run silently debounced the first event of a new session.
   * Created lazily by the hook scripts themselves via `mkdir -p`.
   */
  get runtime() {
    return join(_getRootDir(), "run");
  },
  /**
   * Claude Code's own user-level command directory. bertrand writes the
   * `/bertrand` slash command here, alongside the user's own commands, so
   * every write into it is surgical — see claude/commands.ts.
   *
   * Deliberately NOT redirected by {@link _setRootDir}: this is Claude's
   * directory, not bertrand's, and it does not move when bertrand's home does.
   */
  claudeCommands: join(homedir(), ".claude", "commands"),
  /**
   * The database. Singular — and the same path bertrand used before the
   * per-project split, so an install that never migrated is already here.
   */
  get db() {
    return join(_getRootDir(), "bertrand.db");
  },
  /** Sync credentials for this machine (chmod 0600). */
  get syncEnv() {
    return join(_getRootDir(), "sync.env");
  },
  /** Directory for VACUUM INTO snapshots during sync. */
  get snapshots() {
    return join(_getRootDir(), "snapshots");
  },
} as const;
