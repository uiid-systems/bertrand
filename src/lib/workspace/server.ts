import { execFile, spawn } from "child_process";
import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "fs";
import { join } from "path";
import { paths } from "@/lib/paths";
import { allocatePort, getPort, prunePorts, releasePort } from "./port";
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
  /** How long stop waits after SIGTERM before escalating to SIGKILL. */
  termGraceMs: number;
}

const defaultDeps: Deps = {
  dir: join(paths.root, "workspaces"),
  resolve: resolveWorkspace,
  termGraceMs: 3_000,
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

/** Placeholder pid a start writes while it holds the exclusive start lock. */
const STARTING_PID = -1;

interface PidState {
  /** A real pid, or STARTING_PID while a start holds the lock. */
  pid: number;
  /** Epoch ms when we spawned it; null for legacy bare-number pid files. */
  startedAt: number | null;
}

function readState(sessionId: string): PidState | null {
  try {
    const raw = readFileSync(pidFile(sessionId), "utf-8").trim();
    try {
      const parsed = JSON.parse(raw) as { pid?: unknown; startedAt?: unknown };
      if (
        typeof parsed.pid === "number" &&
        (parsed.pid > 0 || parsed.pid === STARTING_PID)
      ) {
        return {
          pid: parsed.pid,
          startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : null,
        };
      }
      return null;
    } catch {
      // legacy format: a bare pid — identity falls back to the pgid check
      const pid = Number(raw);
      return Number.isFinite(pid) && pid > 0 ? { pid, startedAt: null } : null;
    }
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

/** Parse ps's etime format `[[dd-]hh:]mm:ss` into milliseconds. */
function parseEtimeMs(etime: string): number | null {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(etime.trim());
  if (!m) return null;
  const [, dd, hh, mm, ss] = m;
  return (
    (((Number(dd ?? 0) * 24 + Number(hh ?? 0)) * 60 + Number(mm)) * 60 +
      Number(ss)) *
    1000
  );
}

/**
 * Guard against PID recycling: a pid file survives reboots and OS pids get
 * reused, so before treating (or worse, group-killing) a pid as ours, check
 * that it still looks like the process we spawned. Two cheap signals from one
 * `ps` call: our detached children lead their own process group (pgid == pid),
 * and the process start time (now − etime; elapsed time is TZ-independent,
 * unlike lstart's wall-clock string) must match when we recorded spawning it.
 * An unverifiable pid is treated as NOT ours — the failure mode is a stale
 * status, never a SIGTERM into an innocent process group.
 */
function verifyPidIdentity(pid: number, startedAt: number | null): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("ps", ["-o", "pgid=,etime=", "-p", String(pid)], (err, stdout) => {
      if (err) return resolve(false); // process gone
      const m = /^(\d+)\s+(\S+)$/.exec(stdout.trim());
      if (!m) return resolve(false);
      if (Number(m[1]) !== pid) return resolve(false); // not a group leader
      if (startedAt != null) {
        const elapsed = parseEtimeMs(m[2]!);
        if (elapsed != null) {
          const processStart = Date.now() - elapsed;
          // etime has second precision and clocks drift; 120s of slack is
          // still far tighter than any realistic pid-recycling window.
          if (Math.abs(processStart - startedAt) > 120_000) {
            return resolve(false);
          }
        }
      }
      resolve(true);
    });
  });
}

/**
 * A claim recorded moments ago is trusted without probing the OS. PID
 * recycling needs a reboot or a full pid-space wraparound — neither happens
 * within a minute of us writing the claim — and for claims this fresh the
 * etime check is vacuous anyway (its ±120s tolerance always passes). Probing
 * would be all downside: `ps` can transiently fail under fork pressure, and a
 * just-spawned detached child may not have applied setsid yet (Linux does the
 * child-side setup after fork), so a live fresh pid can flunk the
 * group-leader check. A false negative is not harmless — callers drop the
 * state file on it, permanently orphaning a live server.
 */
function isFreshClaim(startedAt: number | null): boolean {
  return startedAt != null && Date.now() - startedAt < 60_000;
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }
}

/**
 * Dead for our purposes: fully gone (ESRCH), or a zombie awaiting its
 * parent's wait(). A zombie runs no code and holds no ports, but kill(pid, 0)
 * still succeeds on it — and when the stopper is also the spawner (the
 * dashboard server stopping a preview it started), the reap can lag the kill,
 * so a bare liveness probe would spuriously report the process as alive.
 */
function isEffectivelyDead(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
  } catch {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    execFile("ps", ["-o", "stat=", "-p", String(pid)], (err, stdout) => {
      if (err) return resolve(true); // vanished between the checks
      resolve(stdout.trim().startsWith("Z"));
    });
  });
}

async function waitForDeath(pid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await isEffectivelyDead(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return isEffectivelyDead(pid);
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
  const state = readState(sessionId);

  // A start in progress holds a placeholder claim. The locked section is
  // synchronous and completes in milliseconds, so a claim old enough to
  // notice means the starting process crashed mid-way — clear it so the
  // session can't be wedged forever.
  if (state?.pid === STARTING_PID) {
    const fresh =
      state.startedAt != null && Date.now() - state.startedAt < 60_000;
    if (!fresh) removePid(sessionId);
    const claimPort = getPort(sessionId);
    return {
      running: false,
      pid: null,
      port: claimPort,
      observedPort: null,
      listening: false,
      url: claimPort != null ? localhostPreviewUrl(claimPort) : null,
      logFile: logFile(sessionId),
    };
  }

  const pid = state?.pid ?? null;
  // "Running" requires the pid to be alive AND verifiably ours — a recycled
  // pid after a reboot must read as a stale file, not a phantom server.
  const running =
    pid != null &&
    isAlive(pid) &&
    (isFreshClaim(state!.startedAt) ||
      (await verifyPidIdentity(pid, state!.startedAt)));
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

  // Idempotency check goes through the same identity-verified read as status
  // reporting; it also clears any stale or abandoned state file.
  const existing = await getWorkspaceServer(sessionId);
  if (existing.running) return existing;

  const config = deps.resolve(worktreePath);
  if (!config) return null;

  // Exclusive start lock. Two triggers can race a start (the CLI and the
  // dashboard are separate processes; in-process, the await above is a yield
  // point) — the state file is claimed atomically (wx) with a placeholder,
  // so exactly one caller spawns. Losing the race returns the winner's
  // status; an abandoned claim is cleared by getWorkspaceServer after 60s.
  mkdirSync(deps.dir, { recursive: true });
  let lockFd: number;
  try {
    lockFd = openSync(pidFile(sessionId), "wx");
  } catch {
    return getWorkspaceServer(sessionId);
  }
  writeSync(lockFd, JSON.stringify({ pid: STARTING_PID, startedAt: Date.now() }));
  closeSync(lockFd);

  const port = allocatePort(sessionId);
  const url = localhostPreviewUrl(port);
  const env = workspaceEnv({ port, slug, root, previewUrl: url });

  // setup && run, so a fresh worktree installs before the dev server starts.
  const command = config.scripts.setup
    ? `${config.scripts.setup} && ${config.scripts.run}`
    : config.scripts.run;

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
  if (child.pid) {
    const state: PidState = { pid: child.pid, startedAt: Date.now() };
    writeFileSync(pidFile(sessionId), JSON.stringify(state));
  } else {
    // Spawn yielded no pid — release the start lock rather than hold a
    // claim for a server that doesn't exist.
    removePid(sessionId);
  }

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
 *
 * Ordered for truth-telling: SIGTERM the group, wait out the grace period,
 * escalate to SIGKILL if it ignored us, and only clear the state/port once
 * the process is confirmed dead — so a status read right after stop resolves
 * never reports a half-stopped server. A pid that fails the identity check
 * (recycled after a reboot) is never signalled; we just drop our stale claim.
 */
export async function stopWorkspaceServer(sessionId: string): Promise<void> {
  const state = readState(sessionId);
  // pid > 0 also excludes a STARTING_PID claim: kill(-(-1)) / kill(-1) have
  // catastrophic wildcard meanings to the OS, so they must never reach it.
  if (state && state.pid > 0 && isAlive(state.pid)) {
    if (
      isFreshClaim(state.startedAt) ||
      (await verifyPidIdentity(state.pid, state.startedAt))
    ) {
      killGroup(state.pid, "SIGTERM");
      const dead = await waitForDeath(state.pid, deps.termGraceMs);
      if (!dead) {
        killGroup(state.pid, "SIGKILL");
        await waitForDeath(state.pid, 1_000);
      }
    }
  }
  removePid(sessionId);
  releasePort(sessionId);
}

/**
 * Tear down a session's workspace when its worktree life ends (archive today;
 * worktree removal when that lands): stop the dev server, run the repo's
 * committed `archive` script if one exists, release the port. Best-effort by
 * design — teardown must never block or fail the state change that triggered
 * it, so callers typically fire-and-forget this.
 */
export async function teardownWorkspace(input: {
  sessionId: string;
  worktreePath: string | null;
  slug?: string;
}): Promise<void> {
  const { sessionId, worktreePath, slug } = input;
  const port = getPort(sessionId); // read before stop releases it
  await stopWorkspaceServer(sessionId);

  if (!worktreePath || !existsSync(worktreePath)) return;
  const archive = deps.resolve(worktreePath)?.scripts.archive;
  if (!archive) return;

  // The archive script runs like the dev server did: detached, in the
  // worktree, output appended to the session's workspace log. It gets the
  // env it likely names (`docker compose -p $BERTRAND_WORKSPACE down`).
  const env: Record<string, string> = {};
  if (port != null) env.BERTRAND_PORT = String(port);
  if (slug) env.BERTRAND_WORKSPACE = slug;
  try {
    mkdirSync(deps.dir, { recursive: true });
    appendFileSync(logFile(sessionId), `\n[bertrand] running archive script: ${archive}\n`);
    const logFd = openSync(logFile(sessionId), "a");
    const child = spawn("sh", ["-c", archive], {
      cwd: worktreePath,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, ...env },
    });
    child.on("error", (err) => {
      try {
        appendFileSync(logFile(sessionId), `[bertrand] archive script failed to spawn: ${err.message}\n`);
      } catch {
        // best-effort
      }
    });
    child.unref();
    closeSync(logFd);
    // Wait (bounded) for the script to finish: worktree deletion removes the
    // directory right after teardown resolves, and an in-flight script would
    // lose its cwd mid-run. Archive callers `void` this promise, so the wait
    // costs them nothing; the timeout keeps a hung script from wedging anyone.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 30_000);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      child.once("exit", done);
      child.once("error", done);
    });
  } catch {
    // best-effort: a broken archive script must not break archiving
  }
}

/**
 * Stop every workspace server whose session is no longer entitled to one and
 * drop its port allocation. Callers pass the ids that should KEEP their
 * workspace (live, worktree-bearing sessions); everything else found in the
 * state dir or the port registry is reclaimed. Run on dashboard-server boot,
 * this sweeps up servers and ports leaked while nothing was watching —
 * sessions archived from the TUI, worktrees deleted by hand, reboots.
 */
export async function reapOrphanWorkspaces(
  keepSessionIds: Iterable<string>,
): Promise<void> {
  const keep = new Set(keepSessionIds);
  let files: string[];
  try {
    files = readdirSync(deps.dir);
  } catch {
    files = []; // no state dir yet — still prune the registry below
  }
  for (const f of files) {
    if (!f.endsWith(".pid")) continue;
    const sessionId = f.slice(0, -".pid".length);
    if (!keep.has(sessionId)) await stopWorkspaceServer(sessionId);
  }
  prunePorts(keep);
}
