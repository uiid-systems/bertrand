import { mkdirSync } from "fs";
import { runMigrations } from "@/db/migrate";
import { registerProject, removeProject } from "./registry";
import { projectPaths } from "./paths";

/**
 * Materialize a new project end-to-end: registry entry first, then the
 * on-disk directory + SQLite DB. On any failure during the on-disk step
 * the registry entry is rolled back so the failure mode stays "no entry,
 * no dir". The roll-back is itself wrapped in try/catch so a failing
 * `removeProject` doesn't mask the user-visible error.
 *
 * Inversion vs. the obvious "dir first, then registry" order is
 * load-bearing: if we created the directory first, `recoverFromDisk`
 * would synthesize a phantom registry entry from the just-planted
 * `bertrand.db` sentinel and `registerProject` would see "already
 * exists".
 */
export function createProject(opts: { slug: string; name?: string }): void {
  registerProject({ slug: opts.slug, name: opts.name ?? opts.slug });
  try {
    const paths = projectPaths(opts.slug);
    mkdirSync(paths.root, { recursive: true });
    runMigrations(paths.db);
  } catch (err) {
    try {
      removeProject(opts.slug);
    } catch {
      /* preserve original error */
    }
    throw err;
  }
}
