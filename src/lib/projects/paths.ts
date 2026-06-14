import { join } from "path";
import { _getRegistryDir } from "./registry";

export interface ProjectPaths {
  /** Project root: `<registryDir>/projects/<slug>/` */
  root: string;
  /** SQLite database for this project */
  db: string;
  /** Sync configuration for this project (chmod 0600) */
  syncEnv: string;
  /** Directory for VACUUM INTO snapshots during sync */
  snapshots: string;
}

/**
 * Resolve the on-disk paths for a given project slug. Pure path builder —
 * does not create the directory; callers (DB open, sync write) are expected
 * to mkdirSync when they need it.
 *
 * Reads the base directory from the registry module's `_getRegistryDir()` so
 * a test that calls `_setRegistryDir(tmp)` automatically redirects both the
 * registry file AND every project path under it.
 */
export function projectPaths(slug: string): ProjectPaths {
  const root = join(_getRegistryDir(), "projects", slug);
  return {
    root,
    db: join(root, "bertrand.db"),
    syncEnv: join(root, "sync.env"),
    snapshots: join(root, "snapshots"),
  };
}
