/**
 * Pure data shapes for the git layer.
 *
 * A leaf on purpose: `git.ts` shells out via Bun's `$`, so it imports `bun` —
 * unresolvable in the dashboard's Vite build. These shapes are re-exported
 * from `src/types.ts` and rendered by the dashboard's changed-files UI, so
 * they live below that import. Keep this module import-free.
 */

/** A file a session changed, as reported by git's diff parsers. */
export interface ChangedFile {
  path: string;
  /** Line counts from --numstat; null for binary and untracked files. */
  added: number | null;
  removed: number | null;
  status: "added" | "modified" | "deleted" | "untracked";
}
