import { spawn } from "child_process";
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { paths } from "@/lib/paths";

interface Deps {
  pidFile: string;
  port: number;
  resolveBin: () => string | null;
  /**
   * How long to wait for a freshly spawned server to start accepting
   * connections. A cold Bun process binds well inside this; the cap only exists
   * so a server that fails to start can't hang a session launch indefinitely.
   */
  readyTimeoutMs: number;
}

const defaultDeps: Deps = {
  pidFile: join(paths.root, "server.pid"),
  port: Number(process.env.BERTRAND_PORT ?? 5200),
  resolveBin() {
    try {
      const config = JSON.parse(
        readFileSync(join(paths.root, "config.json"), "utf-8")
      );
      return typeof config?.bin === "string" ? config.bin : null;
    } catch {
      return null;
    }
  },
  readyTimeoutMs: 5_000,
};

let deps: Deps = defaultDeps;

/** Test-only seam: swap any subset of the dependencies. */
export function _setTestDeps(override: Partial<Deps>): void {
  deps = { ...defaultDeps, ...override };
}

/** Test-only seam: restore production deps. */
export function _resetTestDeps(): void {
  deps = defaultDeps;
}

function readPidFile(): number | null {
  try {
    const pid = Number(readFileSync(deps.pidFile, "utf-8").trim());
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isPortListening(port: number): Promise<boolean> {
  try {
    await fetch(`http://localhost:${port}/api/sessions`, {
      signal: AbortSignal.timeout(500),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Polls until the port accepts a request or the deadline passes. Resolves
 * either way: the caller's next step is best-effort, so a server that never
 * comes up must not turn into a thrown error at session launch.
 */
async function waitForPortListening(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // `isPortListening` carries its own 500ms timeout, so the loop is paced by
  // the probe itself and this delay only applies to fast refusals.
  while (Date.now() < deadline) {
    if (await isPortListening(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function removePidFile(): void {
  try {
    unlinkSync(deps.pidFile);
  } catch {
    // already gone
  }
}

/**
 * Start `bertrand serve` in a detached background process if no server is
 * already listening. Idempotent: a live PID file or a responsive port both
 * count as "already running" and short-circuit the spawn.
 *
 * **The server is never stopped.** It used to be reference-counted against the
 * number of live sessions across every project, which meant only the launch
 * paths that decrement that count could ever shut it down — the TUI did, while
 * `bertrand adopt` (an Orca session, a bare `claude`, the `/bertrand` skill)
 * neither started nor stopped one. Three independent lifecycles racing over a
 * single shared process produced both failure modes at once: no server when a
 * session needed one, and an orphan server long after the last session ended.
 *
 * Availability is also the point. The dashboard is meant to pair with the
 * hosted page at https://bertrand.sh, which is opened precisely when no session
 * is running — so session-scoped lifetime is the wrong shape for it. An idle
 * Bun process serving read-only SQLite queries is cheap enough that "always up"
 * beats any amount of refcounting.
 *
 * Cost on the hot path is one `kill(pid, 0)` when a server is already healthy;
 * the port probe only runs once the recorded PID is gone.
 *
 * If the user is running `bertrand serve` themselves (e.g. via the dashboard
 * dev script), the port probe sees it and we skip — no PID file is written, so
 * we never claim ownership of a process we didn't spawn.
 */
export async function ensureServerStarted(
  opts: { waitForReady?: boolean } = {},
): Promise<void> {
  const existingPid = readPidFile();
  if (existingPid && isProcessAlive(existingPid)) return;
  if (existingPid) removePidFile();

  if (await isPortListening(deps.port)) return;

  const bin = deps.resolveBin();
  if (!bin) return;

  const child = spawn(bin, ["serve"], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, BERTRAND_PORT: String(deps.port) },
  });
  child.unref();
  if (child.pid) writeFileSync(deps.pidFile, String(child.pid));

  // The engine launches a session within milliseconds of this returning, and
  // that session immediately connects to the server's terminal relay. Returning
  // as soon as the process is spawned handed it a port nothing was listening on
  // yet, so wait until it actually accepts. The relay client retries anyway —
  // this makes the common case deterministic rather than merely recoverable.
  //
  // The UserPromptSubmit hook opts out: it has nothing to connect, and a cold
  // start would otherwise stall the user's first prompt after boot for as long
  // as the readiness timeout. Spawning is enough there; the dashboard is opened
  // by hand long after.
  if (opts.waitForReady === false) return;
  await waitForPortListening(deps.port, deps.readyTimeoutMs);
}
