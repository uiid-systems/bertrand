import { homedir } from "os";
import { join } from "path";

const BERTRAND_DIR = ".bertrand";

export interface ProjectPaths {
  /** Project root: ~/.bertrand/projects/<slug>/ */
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
 */
export function projectPaths(slug: string): ProjectPaths {
  const root = join(homedir(), BERTRAND_DIR, "projects", slug);
  return {
    root,
    db: join(root, "bertrand.db"),
    syncEnv: join(root, "sync.env"),
    snapshots: join(root, "snapshots"),
  };
}
