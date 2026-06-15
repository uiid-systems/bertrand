import { homedir } from "os";
import { join } from "path";

const BERTRAND_DIR = ".bertrand";

/**
 * Global, non-project paths. Hooks and the registry live here because they're
 * shared across every project.
 *
 * `db` and `syncEnv` are the legacy single-DB / single-sync paths. They are
 * deprecated in favor of per-project paths via {@link
 * import("./projects/resolve").resolveActiveProject}; PR2 migrates callers
 * and PR3 moves the legacy data into `projects/default/`.
 */
export const paths = {
  root: join(homedir(), BERTRAND_DIR),
  hooks: join(homedir(), BERTRAND_DIR, "hooks"),
  sessions: join(homedir(), BERTRAND_DIR, "sessions"),
  /**
   * Per-install runtime scratch dir for short-lived markers (debounce,
   * permission-pending). Lived under /tmp historically; moved here because
   * /tmp on macOS survives reboots, so stale markers from a previous
   * bertrand run silently debounced the first event of a new session.
   * Created lazily by the hook scripts themselves via `mkdir -p`.
   */
  runtime: join(homedir(), BERTRAND_DIR, "run"),
  /** @deprecated Use `resolveActiveProject().db`. Removed in PR2. */
  db: join(homedir(), BERTRAND_DIR, "bertrand.db"),
  /** @deprecated Use `resolveActiveProject().syncEnv`. Removed in PR6. */
  syncEnv: join(homedir(), BERTRAND_DIR, "sync.env"),
} as const;
