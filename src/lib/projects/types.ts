/**
 * Pure data shapes for the project registry.
 *
 * A leaf on purpose, for the same reason as `@/lib/github/types`: `registry.ts`
 * reads and writes `projects.json`, so it imports `fs`, `path` and `@/lib/paths`.
 * `src/types.ts` needs `ProjectRepo` to describe an API response and nothing
 * else, and the dashboard typechecks against that barrel — so the definition
 * lives here, below the I/O, and the dependency points at a leaf.
 *
 * Only import from other leaf type modules here.
 */

import type { ProviderIdentity } from "@/lib/github/types";

/**
 * A project's binding to a git repository.
 *
 * `path` is machine-local and `provider` is not: a registry synced to another
 * machine keeps a meaningful `owner/repo` even when the checkout lives
 * somewhere else (or nowhere at all).
 */
export interface ProjectRepo {
  /** Absolute path to the checkout on this machine. */
  path: string;
  /** Portable identity, stable across machines. */
  provider: ProviderIdentity;
  /** Resolved from `origin/HEAD`; absent when it could not be determined. */
  defaultBranch?: string;
}

export interface ProjectEntry {
  slug: string;
  name: string;
  createdAt: string;
  lastUsedAt: string;
  color?: string;
  repo?: ProjectRepo;
  /**
   * Record claude sessions started outside bertrand in this project (ELKY-175).
   *
   * Off unless the user turns it on, and per project rather than global,
   * because the cost of being wrong is asymmetric: a project that wants
   * everything captured says so once, while every other repo on the machine
   * stays untouched. Opt-in is also what keeps auto-creation from re-opening
   * the curation question the TUI's launch step used to answer —
   * `docs/session-identity.md`, "Drift: the required position".
   *
   * Meaningful only on a project with a `repo` binding: a cwd is matched to a
   * project by git origin, so an unbound project can never be the answer.
   */
  autoAdopt?: boolean;
}

export interface ProjectRegistry {
  activeProjectSlug: string;
  projects: ProjectEntry[];
}
