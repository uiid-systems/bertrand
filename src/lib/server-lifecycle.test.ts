import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  ensureServerStarted,
  stopServerIfIdle,
  _setTestDeps,
  _resetTestDeps,
} from "@/lib/server-lifecycle";

const TMP_ROOT = mkdtempSync(join(tmpdir(), "bertrand-lifecycle-"));

/** A port that's almost certainly free and not 5200 (avoid colliding with real bertrand). */
const TEST_PORT = 56_789;

function pidPath(name: string): string {
  return join(TMP_ROOT, `${name}.pid`);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Spawn a long-sleeping child via `sh -c "sleep 30"` so the PID we record
 * stays alive for the duration of a single test. Returns a shell-script
 * bin that exec's sleep — used as the "bertrand" stand-in.
 */
function makeFakeBin(): string {
  const bin = join(TMP_ROOT, "fake-bertrand.sh");
  writeFileSync(bin, "#!/bin/sh\nexec sleep 30\n", { mode: 0o755 });
  return bin;
}

const cleanupPids: number[] = [];

afterAll(() => {
  for (const pid of cleanupPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  _resetTestDeps();
});

describe("ensureServerStarted", () => {
  beforeEach(() => _resetTestDeps());

  test("no-op when PID file holds a live pid", async () => {
    const pidFile = pidPath("live");
    writeFileSync(pidFile, String(process.pid)); // our own PID is alive

    _setTestDeps({
      pidFile,
      port: TEST_PORT,
      resolveBin: () => {
        throw new Error("resolveBin should not be called");
      },
      getActiveCount: () => 0,
    });

    await ensureServerStarted();
    expect(readFileSync(pidFile, "utf-8").trim()).toBe(String(process.pid));
  });

  test("clears stale PID file and spawns a new server", async () => {
    const pidFile = pidPath("stale");
    writeFileSync(pidFile, "99999999"); // unlikely to be a real pid

    _setTestDeps({
      pidFile,
      port: TEST_PORT, // nothing listening here in CI
      resolveBin: makeFakeBin,
      getActiveCount: () => 0,
    });

    await ensureServerStarted();

    const newPid = Number(readFileSync(pidFile, "utf-8").trim());
    cleanupPids.push(newPid);
    expect(newPid).not.toBe(99999999);
    expect(newPid).toBeGreaterThan(0);
    expect(isAlive(newPid)).toBe(true);
  });

  test("no-op when port is already listening", async () => {
    const pidFile = pidPath("port-busy");
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response("ok"),
    });

    try {
      _setTestDeps({
        pidFile,
        port: server.port,
        resolveBin: () => {
          throw new Error("resolveBin should not be called");
        },
        getActiveCount: () => 0,
      });

      await ensureServerStarted();
      expect(existsSync(pidFile)).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("no-op when bin cannot be resolved", async () => {
    const pidFile = pidPath("no-bin");
    _setTestDeps({
      pidFile,
      port: TEST_PORT,
      resolveBin: () => null,
      getActiveCount: () => 0,
    });

    await ensureServerStarted();
    expect(existsSync(pidFile)).toBe(false);
  });
});

describe("stopServerIfIdle", () => {
  beforeEach(() => _resetTestDeps());

  test("kills the spawned process and removes the PID file when no active sessions", async () => {
    const pidFile = pidPath("idle-kill");
    const child = Bun.spawn(["sleep", "30"], { stdio: ["ignore", "ignore", "ignore"] });
    const pid = child.pid;
    cleanupPids.push(pid);
    writeFileSync(pidFile, String(pid));

    _setTestDeps({
      pidFile,
      port: TEST_PORT,
      resolveBin: () => null,
      getActiveCount: () => 0,
    });

    stopServerIfIdle();

    expect(existsSync(pidFile)).toBe(false);
    const start = Date.now();
    while (isAlive(pid) && Date.now() - start < 2000) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(isAlive(pid)).toBe(false);
  });

  test("does nothing when active sessions remain", () => {
    const pidFile = pidPath("idle-keep");
    const child = Bun.spawn(["sleep", "30"], { stdio: ["ignore", "ignore", "ignore"] });
    const pid = child.pid;
    cleanupPids.push(pid);
    writeFileSync(pidFile, String(pid));

    _setTestDeps({
      pidFile,
      port: TEST_PORT,
      resolveBin: () => null,
      getActiveCount: () => 2,
    });

    stopServerIfIdle();

    expect(existsSync(pidFile)).toBe(true);
    expect(isAlive(pid)).toBe(true);

    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  });

  test("no-op when PID file is absent (someone else runs bertrand serve)", () => {
    const pidFile = pidPath("no-pidfile");
    _setTestDeps({
      pidFile,
      port: TEST_PORT,
      resolveBin: () => null,
      getActiveCount: () => 0,
    });

    expect(() => stopServerIfIdle()).not.toThrow();
    expect(existsSync(pidFile)).toBe(false);
  });
});
