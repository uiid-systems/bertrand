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
}

export interface ProjectRegistry {
  activeProjectSlug: string;
  projects: ProjectEntry[];
}
