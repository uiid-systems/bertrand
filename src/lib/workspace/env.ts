/**
 * The environment contract injected into a workspace's setup and run commands.
 * Mirrors Conductor's `CONDUCTOR_*` conventions (docs/workspaces.md). Kept as a
 * pure function so 1B's process manager and the tests share one definition of
 * "what a workspace command sees".
 */

/** Number of ports in the reserved block, base..base+size-1 (doc: "+0..+9"). */
const DEFAULT_PORT_BLOCK = 10;

export interface WorkspaceEnvInput {
  /** Base port allocated to this workspace. */
  port: number;
  /** Session/worktree slug — for naming per-workspace DB files, data dirs, etc. */
  slug: string;
  /** The main checkout path, for symlinking shared files (`.env`, caches). */
  root: string;
  /** The stable preview URL, exported so the app/logs can print it. */
  previewUrl: string;
  /** Reserved-block size; defaults to 10 (base..base+9). */
  portBlockSize?: number;
}

/**
 * Build the env map for a workspace command.
 *
 * `BERTRAND_PORT` is the base; `BERTRAND_PORT_0..N` name the whole reserved
 * block without arithmetic, so a run script for an app that needs several
 * ports can reference `$BERTRAND_PORT_1` directly (`_0` equals the base).
 *
 * `PORT` is also set to the base as a best-effort zero-config nicety: Next,
 * CRA and many servers honor it, so an auto-detected `dev` script binds the
 * deterministic port with no user config. Apps that ignore `PORT` (e.g. Vite)
 * should reference `$BERTRAND_PORT` in a committed `run` override instead.
 */
export function workspaceEnv(input: WorkspaceEnvInput): Record<string, string> {
  const size = input.portBlockSize ?? DEFAULT_PORT_BLOCK;
  const env: Record<string, string> = {
    BERTRAND_PORT: String(input.port),
    BERTRAND_WORKSPACE: input.slug,
    BERTRAND_ROOT: input.root,
    BERTRAND_PREVIEW_URL: input.previewUrl,
    PORT: String(input.port),
  };
  for (let i = 0; i < size; i++) {
    env[`BERTRAND_PORT_${i}`] = String(input.port + i);
  }
  return env;
}

/**
 * Phase 1 preview URL: plain loopback with the allocated port. Branded
 * `*.local.bertrand.sh` subdomains (no port) arrive in Phase 2 with the
 * reverse proxy and local TLS; callers pass whatever this returns as
 * `previewUrl`, so swapping the scheme later touches only this function.
 */
export function localhostPreviewUrl(port: number): string {
  return `http://localhost:${port}`;
}
