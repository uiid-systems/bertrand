/**
 * The environment contract injected into a workspace's setup and run commands.
 * Mirrors Conductor's `CONDUCTOR_*` conventions (docs/workspaces.md). Kept as a
 * pure function so 1B's process manager and the tests share one definition of
 * "what a workspace command sees".
 */

export interface WorkspaceEnvInput {
  /** Port allocated to this workspace. */
  port: number;
  /** Session/worktree slug — for naming per-workspace DB files, data dirs, etc. */
  slug: string;
  /** The main checkout path, for symlinking shared files (`.env`, caches). */
  root: string;
  /** The stable preview URL, exported so the app/logs can print it. */
  previewUrl: string;
  /** Port allocated to the API sidecar, when the workspace has an `api` script. */
  apiPort?: number;
}

/**
 * Build the env map for a workspace command.
 *
 * One port per workspace: the allocator reserves exactly one slot, so one
 * port is all we can honestly promise. (An earlier draft exported a
 * `BERTRAND_PORT_0..9` block, but the registry never reserved those ports —
 * a neighboring session could be allocated one of them as its *base*. Strided
 * allocation can bring the block back if multi-port apps show up in Phase 3.)
 *
 * `PORT` is also set as a best-effort zero-config nicety: Next, CRA and many
 * servers honor it, so an auto-detected `dev` script binds the deterministic
 * port with no user config. Apps that ignore `PORT` (e.g. Vite) should
 * reference `$BERTRAND_PORT` in a committed `run` override instead.
 *
 * A workspace with an `api` sidecar additionally gets `BERTRAND_API_PORT`
 * (the sidecar's allocated slot) and `BERTRAND_API_TARGET` (the origin a
 * UI's `/api` proxy should forward to). Both commands see the same map —
 * the sidecar's own `PORT` remap happens in the launch script, not here.
 */
export function workspaceEnv(input: WorkspaceEnvInput): Record<string, string> {
  return {
    BERTRAND_PORT: String(input.port),
    BERTRAND_WORKSPACE: input.slug,
    BERTRAND_ROOT: input.root,
    BERTRAND_PREVIEW_URL: input.previewUrl,
    PORT: String(input.port),
    ...(input.apiPort != null
      ? {
          BERTRAND_API_PORT: String(input.apiPort),
          BERTRAND_API_TARGET: localhostPreviewUrl(input.apiPort),
        }
      : {}),
  };
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
