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

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(pred: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!pred() && Date.now() - start < ms) {
    await new Promise((r) => setTimeout(r, 25));
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

  test("spawns a live process and reports a status with port + url", () => {
    const { worktree } = freshDirs(() => sleeper());
    const status = startWorkspaceServer(input(worktree))!;
    cleanupPids.push(status.pid!);

    expect(status.running).toBe(true);
    expect(status.pid).toBeGreaterThan(0);
    expect(isAlive(status.pid!)).toBe(true);
    expect(status.port).toBeGreaterThanOrEqual(4700);
    expect(status.url).toBe(`http://localhost:${status.port}`);
    expect(existsSync(status.logFile)).toBe(true);
  });

  test("returns null when the worktree has no previewable dev command", () => {
    const { worktree } = freshDirs(() => null);
    expect(startWorkspaceServer(input(worktree))).toBeNull();
  });

  test("is idempotent — a live server short-circuits, no second spawn", () => {
    const { worktree } = freshDirs(() => sleeper());
    const first = startWorkspaceServer(input(worktree))!;
    cleanupPids.push(first.pid!);
    const second = startWorkspaceServer(input(worktree))!;
    expect(second.pid).toBe(first.pid);
  });

  test("streams the command's output to the log file", async () => {
    const { worktree } = freshDirs(() => sleeper("echo preview-marker && sleep 30"));
    const status = startWorkspaceServer(input(worktree))!;
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
    const status = startWorkspaceServer(input(worktree))!;
    const pid = status.pid!;
    cleanupPids.push(pid);

    stopWorkspaceServer("sess-1");
    await waitFor(() => !isAlive(pid));
    expect(isAlive(pid)).toBe(false);
    // stop releases the port, so status is fully cleared
    const after = getWorkspaceServer("sess-1");
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

  test("reports not-running with no port before any start (no allocation on read)", () => {
    freshDirs(() => sleeper());
    const status = getWorkspaceServer("sess-1");
    expect(status.running).toBe(false);
    expect(status.pid).toBeNull();
    expect(status.port).toBeNull();
    expect(status.url).toBeNull();
  });

  test("reports the running server's port + url", () => {
    const { worktree } = freshDirs(() => sleeper());
    const started = startWorkspaceServer(input(worktree))!;
    cleanupPids.push(started.pid!);
    const status = getWorkspaceServer("sess-1");
    expect(status.running).toBe(true);
    expect(status.port).toBe(started.port);
    expect(status.url).toBe(`http://localhost:${started.port}`);
  });
});
