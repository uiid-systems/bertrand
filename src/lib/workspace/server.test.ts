import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  startWorkspaceServer,
  stopWorkspaceServer,
  getWorkspaceServer,
  _setServerDeps,
  _resetServerDeps,
} from "@/lib/workspace/server";
import { _setPortDeps, _resetPortDeps } from "@/lib/workspace/port";
import type { WorkspaceRunConfig } from "@/lib/workspace/types";

const dirs: string[] = [];
const cleanupPids: number[] = [];

/** A config whose run command stays alive so the recorded PID survives a test. */
const sleeper = (run = "sleep 30"): WorkspaceRunConfig => ({
  scripts: { run },
  packageManager: "bun",
  source: "detected",
});

/**
 * A config whose run command actually LISTENs, so observed-port detection has
 * something to find. `portExpr` is evaluated in the child (e.g.
 * `Number(process.env.PORT) + 7` to simulate an app ignoring its assignment).
 */
const listener = (portExpr = "Number(process.env.PORT)"): WorkspaceRunConfig => ({
  scripts: {
    run: `bun -e "Bun.serve({ port: ${portExpr}, fetch: () => new Response('ok') }); setTimeout(() => {}, 30000)"`,
  },
  packageManager: "bun",
  source: "detected",
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(
  pred: () => boolean | Promise<boolean>,
  ms = 5000,
): Promise<void> {
  const start = Date.now();
  while (!(await pred()) && Date.now() - start < ms) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

function freshDirs(resolve: (dir: string) => WorkspaceRunConfig | null): {
  worktree: string;
} {
  const base = mkdtempSync(join(tmpdir(), "bertrand-wss-"));
  dirs.push(base);
  _setServerDeps({ dir: join(base, "state"), resolve });
  _setPortDeps({ registryDir: join(base, "ports") });
  return { worktree: base };
}

const input = (worktree: string) => ({
  sessionId: "sess-1",
  worktreePath: worktree,
  root: "/repo",
  slug: "my-feature",
});

afterAll(() => {
  for (const pid of cleanupPids) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {}
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  _resetServerDeps();
  _resetPortDeps();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("startWorkspaceServer", () => {
  beforeEach(() => {
    _resetServerDeps();
    _resetPortDeps();
  });

  test("spawns a live process and reports a status with port + url", async () => {
    const { worktree } = freshDirs(() => sleeper());
    const status = (await startWorkspaceServer(input(worktree)))!;
    cleanupPids.push(status.pid!);

    expect(status.running).toBe(true);
    expect(status.pid).toBeGreaterThan(0);
    expect(isAlive(status.pid!)).toBe(true);
    expect(status.port).toBeGreaterThanOrEqual(4700);
    expect(status.url).toBe(`http://localhost:${status.port}`);
    // fresh spawn: nothing can be listening yet — that arrives via polling
    expect(status.listening).toBe(false);
    expect(status.observedPort).toBeNull();
    expect(existsSync(status.logFile)).toBe(true);
  });

  test("returns null when the worktree has no previewable dev command", async () => {
    const { worktree } = freshDirs(() => null);
    expect(await startWorkspaceServer(input(worktree))).toBeNull();
  });

  test("is idempotent — a live server short-circuits, no second spawn", async () => {
    const { worktree } = freshDirs(() => sleeper());
    const first = (await startWorkspaceServer(input(worktree)))!;
    cleanupPids.push(first.pid!);
    const second = (await startWorkspaceServer(input(worktree)))!;
    expect(second.pid).toBe(first.pid);
  });

  test("streams the command's output to the log file", async () => {
    const { worktree } = freshDirs(() => sleeper("echo preview-marker && sleep 30"));
    const status = (await startWorkspaceServer(input(worktree)))!;
    cleanupPids.push(status.pid!);
    await waitFor(() => readFileSync(status.logFile, "utf-8").includes("preview-marker"));
    expect(readFileSync(status.logFile, "utf-8")).toContain("preview-marker");
  });
});

describe("stopWorkspaceServer", () => {
  beforeEach(() => {
    _resetServerDeps();
    _resetPortDeps();
  });

  test("kills the process, clears the PID file, and releases the port", async () => {
    const { worktree } = freshDirs(() => sleeper());
    const status = (await startWorkspaceServer(input(worktree)))!;
    const pid = status.pid!;
    cleanupPids.push(pid);

    stopWorkspaceServer("sess-1");
    await waitFor(() => !isAlive(pid));
    expect(isAlive(pid)).toBe(false);
    // stop releases the port, so status is fully cleared
    const after = await getWorkspaceServer("sess-1");
    expect(after.running).toBe(false);
    expect(after.pid).toBeNull();
    expect(after.port).toBeNull();
    expect(after.url).toBeNull();
  });

  test("is a no-op for a session that was never started", () => {
    freshDirs(() => sleeper());
    expect(() => stopWorkspaceServer("never")).not.toThrow();
  });
});

describe("getWorkspaceServer", () => {
  beforeEach(() => {
    _resetServerDeps();
    _resetPortDeps();
  });

  test("reports not-running with no port before any start (no allocation on read)", async () => {
    freshDirs(() => sleeper());
    const status = await getWorkspaceServer("sess-1");
    expect(status.running).toBe(false);
    expect(status.pid).toBeNull();
    expect(status.port).toBeNull();
    expect(status.listening).toBe(false);
    expect(status.observedPort).toBeNull();
    expect(status.url).toBeNull();
  });

  test("a running process that binds nothing is not 'listening'", async () => {
    const { worktree } = freshDirs(() => sleeper());
    const started = (await startWorkspaceServer(input(worktree)))!;
    cleanupPids.push(started.pid!);
    const status = await getWorkspaceServer("sess-1");
    expect(status.running).toBe(true);
    expect(status.listening).toBe(false);
    expect(status.observedPort).toBeNull();
    // url still reports the assigned port so callers can show "will be here"
    expect(status.url).toBe(`http://localhost:${started.port}`);
  });

  test("observes the assigned port when the app honors PORT", async () => {
    const { worktree } = freshDirs(() => listener());
    const started = (await startWorkspaceServer(input(worktree)))!;
    cleanupPids.push(started.pid!);

    await waitFor(async () => (await getWorkspaceServer("sess-1")).listening);
    const status = await getWorkspaceServer("sess-1");
    expect(status.listening).toBe(true);
    expect(status.observedPort).toBe(started.port);
    expect(status.url).toBe(`http://localhost:${started.port}`);
  });

  test("follows the real port when the app ignores PORT", async () => {
    // Simulates Vite/pinned-port apps: binds assigned+7, not the assignment.
    const { worktree } = freshDirs(() => listener("Number(process.env.PORT) + 7"));
    const started = (await startWorkspaceServer(input(worktree)))!;
    cleanupPids.push(started.pid!);

    await waitFor(async () => (await getWorkspaceServer("sess-1")).listening);
    const status = await getWorkspaceServer("sess-1");
    expect(status.listening).toBe(true);
    expect(status.port).toBe(started.port); // the assignment is still reported
    expect(status.observedPort).toBe(started.port! + 7);
    // the URL must always be true: it follows the observed port
    expect(status.url).toBe(`http://localhost:${started.port! + 7}`);
  });
});
