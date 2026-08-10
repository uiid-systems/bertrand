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
 * - `api` boots the branch's API server alongside `run`, on a second
 *   allocated port (`$BERTRAND_API_PORT`), for branches whose UI preview
 *   needs the branch's API too. Optional and override-only — there is no
 *   auto-detected shape for "this repo's API server".
 * - `archive` tears the workspace down. Optional.
 */
export interface WorkspaceScripts {
  setup?: string;
  run: string;
  api?: string;
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
  api?: string;
  archive?: string;
  devCommand?: string;
}

/**
 * What `getWorkspaceServer` reports about a session's dev server, and what
 * `/api/worktrees` serves to the dashboard.
 *
 * The shape lives here rather than in `server.ts` because `src/types.ts`
 * embeds it in `WorktreeSessionRow`, and the dashboard typechecks against
 * that barrel. Declared next to the process manager it would drag
 * `child_process`, `fs` and `path` into the dashboard's type graph.
 */
export interface WorkspaceServerStatus {
  running: boolean;
  pid: number | null;
  /** Allocated port, or null when the session has never been started. */
  port: number | null;
  /**
   * Port the process group is actually LISTENing on, or null when nothing is
   * (yet). Can legitimately differ from `port`: the app may ignore `PORT`
   * (Vite), pin its own port, or auto-increment on a conflict (Next).
   */
  observedPort: number | null;
  /** True when the running process group accepts connections on observedPort. */
  listening: boolean;
  /**
   * Preview URL. Follows `observedPort` when listening — the URL must always
   * be true — and falls back to the allocated port (the URL the server *will*
   * get) while starting. Null when no port is allocated.
   */
  url: string | null;
  /**
   * API sidecar state, or null when the workspace has none (no `api` script
   * — the common, UI-only case). `listening` means observed on the assigned
   * port specifically: the UI's `/api` proxy target is pinned to that port
   * (`BERTRAND_API_TARGET`), so a sidecar bound anywhere else is unreachable
   * and honestly reads as down.
   */
  api: { port: number; listening: boolean } | null;
  logFile: string;
}
