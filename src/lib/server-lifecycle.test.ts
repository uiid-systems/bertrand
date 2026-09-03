import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  ensureServerStarted,
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
      // The fake bin never binds a port, so cap the readiness wait rather than
      // spending the production timeout proving it.
      readyTimeoutMs: 50,
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
    });

    await ensureServerStarted();
    expect(existsSync(pidFile)).toBe(false);
  });

  test("waitForReady:false returns without waiting for the port to accept", async () => {
    const pidFile = pidPath("no-wait");
    _setTestDeps({
      pidFile,
      port: TEST_PORT, // nothing listening here in CI
      resolveBin: makeFakeBin,
      // Deliberately long: the point is that the opt-out path never reaches it.
      // The UserPromptSubmit hook calls this on every turn, so a cold start
      // must not stall the user behind a readiness probe.
      readyTimeoutMs: 10_000,
    });

    const start = Date.now();
    await ensureServerStarted({ waitForReady: false });
    const elapsed = Date.now() - start;

    const newPid = Number(readFileSync(pidFile, "utf-8").trim());
    cleanupPids.push(newPid);
    expect(newPid).toBeGreaterThan(0);
    // Spawned, but returned nowhere near the readiness timeout.
    expect(elapsed).toBeLessThan(2_000);
  });
});
