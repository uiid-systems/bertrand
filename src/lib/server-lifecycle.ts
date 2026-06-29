import { spawn } from "child_process";
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { paths } from "@/lib/paths";
import { getActiveSessions } from "@/db/queries/sessions";

interface Deps {
  pidFile: string;
  port: number;
  resolveBin: () => string | null;
  getActiveCount: () => number;
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
  getActiveCount: () => getActiveSessions().length,
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
 * If the user is running `bertrand serve` themselves (e.g. via the dashboard
 * dev script), the port probe sees it and we skip — no PID file is written,
 * so `stopServerIfIdle` won't try to kill it later either.
 */
export async function ensureServerStarted(): Promise<void> {
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
}

/**
 * Recovery path: ensure a server is running *iff* a session still needs one.
 *
 * When the user runs the dashboard `bun dev` script, its API server holds the
 * port and `ensureServerStarted` defers to it (no spawn, no PID file). If that
 * dev server later goes away mid-session — Ctrl+C, crash — nothing is left to
 * serve the dashboard even though a bertrand session is still live. Calling
 * this hands ownership back to bertrand: it spawns a detached `bertrand serve`
 * (with a PID file, so `stopServerIfIdle` reclaims it at session end).
 *
 * No-op when no session is active, so it never resurrects a server nothing
 * needs — "always running when needed, never running when it isn't".
 */
export async function ensureServerForActiveSessions(): Promise<void> {
  if (deps.getActiveCount() === 0) return;
  await ensureServerStarted();
}

/**
 * Stop the auto-started server if there are no active sessions left.
 * Caller must have already transitioned its own session out of active state
 * before invoking this so the count reflects post-shutdown reality.
 *
 * No-op when the PID file is missing — we only manage servers we spawned.
 */
export function stopServerIfIdle(): void {
  if (deps.getActiveCount() > 0) return;

  const pid = readPidFile();
  if (!pid) return;

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // already gone
  }
  removePidFile();
}
