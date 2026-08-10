/**
 * Pure data shapes for worktree removal.
 *
 * A leaf on purpose: `worktree-remove.ts` deletes directories and writes the
 * session record, so it imports `fs`, the db layer and `@/lib/git` (and so
 * `bun`). The dashboard renders the failure reason and needs nothing else, so
 * the union lives below that I/O. Keep this module import-free.
 */

/** Why `removeSessionWorktree` declined or failed. */
export type RemoveWorktreeReason =
  | "not-found"
  | "no-worktree"
  | "active"
  | "dirty"
  | "git-failed";
