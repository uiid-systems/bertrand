import { spawn } from "child_process";
import { mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { paths } from "@/lib/paths";
import { allocatePort, releasePort } from "./port";
import { localhostPreviewUrl, workspaceEnv } from "./env";
import { resolveWorkspace } from "./resolve";
import type { WorkspaceRunConfig } from "./types";

/**
 * Per-worktree dev-server process manager (docs/workspaces.md, Phase 1B).
 *
 * Modeled on `server-lifecycle.ts`: spawn a detached process, track it by a
 * PID file, probe liveness with `kill(pid, 0)`. One server per session, keyed
 * by session id, with its own log file so the dashboard/CLI can tail it.
 *
 * The server runs the resolved `setup && run` in the worktree cwd with the
 * injected `BERTRAND_*` env. It is detached and its output goes to a log file,
 * so starting it never blocks the caller on a slow `install` or a long-lived
 * dev server.
 */
export interface WorkspaceServerStatus {
  running: boolean;
  pid: number | null;
  port: number;
  url: string;
  logFile: string;
}

export interface StartWorkspaceInput {
  sessionId: string;
  /** The worktree directory the dev server runs in. */
  worktreePath: string;
  /** The main checkout path, exported as BERTRAND_ROOT. */
  root: string;
  /** Session/worktree slug, exported as BERTRAND_WORKSPACE. */
  slug: string;
}

interface Deps {
  dir: string;
  resolve: (dir: string) => WorkspaceRunConfig | null;
}

const defaultDeps: Deps = {
  dir: join(paths.root, "workspaces"),
  resolve: resolveWorkspace,
};
let deps: Deps = defaultDeps;

/** Test-only seam: swap the workspaces dir and/or the config resolver. */
export function _setServerDeps(override: Partial<Deps>): void {
  deps = { ...defaultDeps, ...override };
}

/** Test-only seam: restore production deps. */
export function _resetServerDeps(): void {
  deps = defaultDeps;
}

function pidFile(sessionId: string): string {
  return join(deps.dir, `${sessionId}.pid`);
}

function logFile(sessionId: string): string {
  return join(deps.dir, `${sessionId}.log`);
}

function readPid(sessionId: string): number | null {
  try {
    const pid = Number(readFileSync(pidFile(sessionId), "utf-8").trim());
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function removePid(sessionId: string): void {
  try {
    unlinkSync(pidFile(sessionId));
  } catch {
    // already gone
  }
}

/**
 * Current status of a session's workspace server. `running` reflects a live
 * PID; the port/url are reported whenever the session holds an allocation,
 * even when stopped, so the caller can show a stable URL and lazily start.
 */
export function getWorkspaceServer(sessionId: string): WorkspaceServerStatus | null {
  const pid = readPid(sessionId);
  const running = pid != null && isAlive(pid);
  if (pid != null && !running) removePid(sessionId); // clear stale
  const port = allocatePort(sessionId);
  return {
    running,
    pid: running ? pid : null,
    port,
    url: localhostPreviewUrl(port),
    logFile: logFile(sessionId),
  };
}

/**
 * Start (or no-op if already running) the workspace dev server for a session.
 *
 * Returns null when the worktree has no previewable dev command — the caller
 * should treat that as "nothing to run", not an error. Idempotent: a live
 * server short-circuits and its status is returned unchanged.
 */
export function startWorkspaceServer(
  input: StartWorkspaceInput,
): WorkspaceServerStatus | null {
  const { sessionId, worktreePath, root, slug } = input;

  const existing = readPid(sessionId);
  if (existing != null && isAlive(existing)) {
    return getWorkspaceServer(sessionId);
  }
  if (existing != null) removePid(sessionId); // stale

  const config = deps.resolve(worktreePath);
  if (!config) return null;

  const port = allocatePort(sessionId);
  const url = localhostPreviewUrl(port);
  const env = workspaceEnv({ port, slug, root, previewUrl: url });

  // setup && run, so a fresh worktree installs before the dev server starts.
  const command = config.scripts.setup
    ? `${config.scripts.setup} && ${config.scripts.run}`
    : config.scripts.run;

  mkdirSync(deps.dir, { recursive: true });
  const logFd = openSync(logFile(sessionId), "a");

  const child = spawn("sh", ["-c", command], {
    cwd: worktreePath,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, ...env },
  });
  child.unref();
  if (child.pid) writeFileSync(pidFile(sessionId), String(child.pid));

  return {
    running: child.pid != null,
    pid: child.pid ?? null,
    port,
    url,
    logFile: logFile(sessionId),
  };
}

/**
 * Stop a session's workspace server and release its port. Best-effort:
 * a missing PID file or an already-dead process is not an error. Signals the
 * whole process group (negative pid) so the `sh -c` wrapper and the dev server
 * it spawned both go down, not just the shell.
 */
export function stopWorkspaceServer(sessionId: string): void {
  const pid = readPid(sessionId);
  if (pid != null) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
  }
  removePid(sessionId);
  releasePort(sessionId);
}
