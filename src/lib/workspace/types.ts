/**
 * Types for the workspace preview layer (docs/workspaces.md, Phase 1A).
 *
 * A "workspace" is the running side of a session's git worktree: the dev
 * server plus the config that launches it. This module only describes the
 * shapes; resolution lives in `resolve.ts`, process management arrives in 1B.
 */

/** Package managers we detect from a lockfile, in precedence order. */
export type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

/**
 * Conductor's three-verb lifecycle. Each is a shell command string (run via
 * the user's shell so `$BERTRAND_PORT` interpolation and flags Just Work),
 * not an argv array.
 *
 * - `setup` runs once per new worktree — everything git doesn't track
 *   (install deps, symlink `.env`). Optional: absent means "nothing to do".
 * - `run` launches the dev server. Required — a workspace with no `run` is
 *   not previewable, which is why `resolveWorkspace` returns null in that case.
 * - `archive` tears the workspace down. Optional.
 */
export interface WorkspaceScripts {
  setup?: string;
  run: string;
  archive?: string;
}

/**
 * Fully resolved config for previewing one workspace directory.
 * `source` records where `run` came from — auto-detected from
 * `package.json` `scripts.dev`, or a repo-committed override — so callers
 * (and logs) can explain why a workspace runs the command it does.
 */
export interface WorkspaceRunConfig {
  scripts: WorkspaceScripts;
  packageManager: PackageManager | null;
  source: "detected" | "override";
}

/**
 * Repo-committed override, read from `.bertrand/config.json` or the
 * `bertrand` key in `package.json`. Versioned with the project so a teammate
 * cloning it inherits the same preview behavior. All fields optional; any
 * provided one wins over auto-detection for that verb.
 *
 * `devCommand` is an alias for `run` (matches the doc's wording); if both are
 * present, `run` wins.
 */
export interface RepoWorkspaceConfig {
  setup?: string;
  run?: string;
  archive?: string;
  devCommand?: string;
}
