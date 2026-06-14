import {
  DEFAULT_PROJECT_SLUG,
  getActiveProjectSlug,
  listProjects,
} from "./registry";
import { projectPaths, type ProjectPaths } from "./paths";

export interface ActiveProject extends ProjectPaths {
  /** Project slug (immutable, doubles as the directory name) */
  slug: string;
  /** Human-readable display name */
  name: string;
}

let _cached: ActiveProject | null = null;

/**
 * Resolve the active project for the current process. Memoized for the
 * process lifetime — once resolved, the answer is frozen so background hooks
 * and the foreground CLI don't disagree if the user runs `project switch`
 * mid-session in another shell.
 *
 * Resolution order:
 *   1. `BERTRAND_PROJECT` env var (set at launch by `engine/process.ts` in
 *      PR4 so hooks inherit it from spawn time, not the live registry)
 *   2. `activeProjectSlug` in `~/.bertrand/projects.json`
 *   3. The literal `DEFAULT_PROJECT_SLUG` ("default") — used for fresh
 *      installs before any project is registered.
 *
 * The resolved slug doesn't have to exist on disk yet; PR2 (DB scoping)
 * mkdirSyncs the project root on first DB open.
 */
export function resolveActiveProject(): ActiveProject {
  if (_cached) return _cached;

  const envSlug = process.env.BERTRAND_PROJECT;
  let slug: string;
  if (envSlug && envSlug.trim()) {
    slug = envSlug.trim();
  } else {
    slug = getActiveProjectSlug();
  }

  const entry = listProjects().find((p) => p.slug === slug);
  const name = entry?.name ?? slug;

  _cached = { slug, name, ...projectPaths(slug) };
  return _cached;
}

/**
 * Drop the memoized active project. Tests use this to flip env vars and
 * registry state between cases. Production code shouldn't call this — the
 * memoization is a deliberate barrier against mid-process drift.
 */
export function _resetActiveProjectCache(): void {
  _cached = null;
}
