import { execFile, spawn } from "child_process";
import {
  appendFileSync,
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { paths } from "@/lib/paths";
import { allocatePort, getPort, releasePort } from "./port";
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

/**
 * Rotate the previous run's log out of the way (one generation kept as
 * `.log.1`) so logs don't grow forever across restarts and a fresh start
 * reads as a fresh log.
 */
function rotateLog(sessionId: string): void {
  try {
    renameSync(logFile(sessionId), `${logFile(sessionId)}.1`);
  } catch {
    // no previous log — first start
  }
}

/**
 * Tail of a session's dev-server log. Reads a bounded window from the end of
 * the file — this sits on the dashboard's poll path and dev-server logs grow
 * without limit, so whole-file reads are off the table.
 */
export function readWorkspaceLog(sessionId: string, lines = 200): string {
  const MAX_BYTES = 64 * 1024;
  try {
    const fd = openSync(logFile(sessionId), "r");
    try {
      const size = fstatSync(fd).size;
      const start = Math.max(0, size - MAX_BYTES);
      const buf = Buffer.alloc(size - start);
      readSync(fd, buf, 0, buf.length, start);
      let text = buf.toString("utf-8");
      if (start > 0) {
        // drop the partial line a mid-file cut leaves at the top
        const nl = text.indexOf("\n");
        if (nl !== -1) text = text.slice(nl + 1);
      }
      return text.split("\n").slice(-Math.max(1, lines)).join("\n");
    } finally {
      closeSync(fd);
    }
  } catch {
    return "";
  }
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
 * TCP ports the process group is LISTENing on. The detached child is its own
 * group leader, so its pid doubles as the pgid and `lsof -g` covers both the
 * `sh -c` wrapper and whatever dev server it spawned. Best-effort: any lsof
 * failure (not installed, no matches — it exits 1 for both) reads as "nothing
 * observed", never as an error.
 */
function listeningPorts(pgid: number): Promise<number[]> {
  return new Promise((resolve) => {
    execFile(
      "lsof",
      ["-a", "-g", String(pgid), "-iTCP", "-sTCP:LISTEN", "-n", "-P", "-Fn"],
      (err, stdout) => {
        if (err) return resolve([]);
        const ports = new Set<number>();
        for (const line of stdout.split("\n")) {
          // -Fn emits name lines like `n*:4700` / `n127.0.0.1:4700`.
          const m = /^n.*:(\d+)$/.exec(line.trim());
          if (m) ports.add(Number(m[1]));
        }
        resolve([...ports].sort((a, b) => a - b));
      },
    );
  });
}

/**
 * Current status of a session's workspace server — a read with no allocation
 * side effects. `running` reflects a live PID; `port`/`url` are reported only
 * when a port is already allocated (i.e. the session has been started at
 * least once and not stopped), so merely *viewing* the dashboard never
 * allocates a port for a session you haven't opened. Allocation happens on
 * start.
 *
 * Listening state is *observed*, not assumed: we ask the OS which port the
 * process group actually bound rather than trusting that the app honored
 * `PORT`. This is what lets callers distinguish "installing/compiling"
 * (running, not listening) from "up" (listening), and keeps the reported URL
 * correct even when the app picked its own port.
 */
export async function getWorkspaceServer(
  sessionId: string,
): Promise<WorkspaceServerStatus> {
  const pid = readPid(sessionId);
  const running = pid != null && isAlive(pid);
  if (pid != null && !running) removePid(sessionId); // clear stale
  const port = getPort(sessionId);

  const observed = running ? await listeningPorts(pid!) : [];
  // Prefer the allocated port when the group holds several (e.g. an HMR
  // socket next to the app); otherwise the lowest bound port is the app.
  const observedPort =
    observed.length === 0
      ? null
      : port != null && observed.includes(port)
        ? port
        : observed[0]!;
  const listening = observedPort != null;

  const urlPort = observedPort ?? port;
  return {
    running,
    pid: running ? pid : null,
    port,
    observedPort,
    listening,
    url: urlPort != null ? localhostPreviewUrl(urlPort) : null,
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
export async function startWorkspaceServer(
  input: StartWorkspaceInput,
): Promise<WorkspaceServerStatus | null> {
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
  rotateLog(sessionId);
  const logFd = openSync(logFile(sessionId), "a");

  const child = spawn("sh", ["-c", command], {
    cwd: worktreePath,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, ...env },
  });
  // Without a listener, a spawn failure raises an uncaught exception in the
  // *calling* process (the dashboard server). Surface it in the log instead.
  child.on("error", (err) => {
    try {
      appendFileSync(logFile(sessionId), `\n[bertrand] failed to spawn dev server: ${err.message}\n`);
    } catch {
      // the log itself is best-effort
    }
    removePid(sessionId);
  });
  child.unref();
  // The child holds its own copy of the fd; keeping ours open would leak one
  // fd per start for the life of this process.
  closeSync(logFd);
  if (child.pid) writeFileSync(pidFile(sessionId), String(child.pid));

  // A freshly spawned server can't have bound anything yet; callers poll
  // getWorkspaceServer for the listening/observed-port transition.
  return {
    running: child.pid != null,
    pid: child.pid ?? null,
    port,
    observedPort: null,
    listening: false,
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
