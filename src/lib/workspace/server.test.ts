import { describe, test, expect, beforeEach, afterEach, afterAll } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execFileSync } from "node:child_process";
import {
  startWorkspaceServer,
  stopWorkspaceServer,
  getWorkspaceServer,
  readWorkspaceLog,
  teardownWorkspace,
  reapOrphanWorkspaces,
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

/**
 * A SIGKILL'd child of THIS process becomes a zombie until the runtime reaps
 * it, and `kill(pid, 0)` keeps succeeding on a zombie — so a bare liveness
 * probe can wait indefinitely for a reap that lags under CI load (the flake
 * this replaces). A zombie runs no code and holds no ports; treat it as dead,
 * exactly as the server's own `isEffectivelyDead` does.
 */
function isEffectivelyDead(pid: number): boolean {
  if (!isAlive(pid)) return true; // fully gone (ESRCH)
  try {
    const stat = execFileSync("ps", ["-o", "stat=", "-p", String(pid)], {
      encoding: "utf8",
    });
    return stat.trim().startsWith("Z"); // zombie
  } catch {
    return true; // vanished between the two checks
  }
}

async function expectDead(pid: number): Promise<void> {
  await waitFor(() => isEffectivelyDead(pid));
  expect(isEffectivelyDead(pid)).toBe(true);
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

function freshDirs(
  resolve: (dir: string) => WorkspaceRunConfig | null,
  termGraceMs?: number,
): {
  worktree: string;
  stateDir: string;
} {
  const base = mkdtempSync(join(tmpdir(), "bertrand-wss-"));
  dirs.push(base);
  _setServerDeps({
    dir: join(base, "state"),
    resolve,
    ...(termGraceMs != null ? { termGraceMs } : {}),
  });
  _setPortDeps({ registryDir: join(base, "ports") });
  return { worktree: base, stateDir: join(base, "state") };
}

const input = (worktree: string) => ({
  sessionId: "sess-1",
  worktreePath: worktree,
  root: "/repo",
  slug: "my-feature",
});

// Tear down each test's spawned servers before the next test starts. Leaving
// them alive until afterAll piled every test's process onto the shared
// 4700–4899 preview-port range at once; since every test also targets the same
// session id (so the same base port), that contention is what made the
// port-assignment and teardown-timing assertions flake on loaded CI runners.
// Reclaiming ports per test keeps one live server at a time, mirroring
// production's one-server-per-session model.
afterEach(async () => {
  const pids = cleanupPids.splice(0);
  for (const pid of pids) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {}
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  await Promise.all(pids.map((pid) => waitFor(() => isEffectivelyDead(pid))));
});

afterAll(() => {
  // Backstop: afterEach normally drains cleanupPids, so this only catches pids
  // from a test that threw before its afterEach ran.
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

  test("concurrent starts race to one spawn (start lock)", async () => {
    const { worktree } = freshDirs(() => sleeper());
    const [a, b] = await Promise.all([
      startWorkspaceServer(input(worktree)),
      startWorkspaceServer(input(worktree)),
    ]);
    const winner = [a, b].find((s) => s?.pid != null && s.pid > 0)!;
    cleanupPids.push(winner.pid!);
    // exactly one process exists; the loser reports the winner's server
    const status = await getWorkspaceServer("sess-1");
    expect(status.running).toBe(true);
    expect(status.pid).toBe(winner.pid);
    expect(a?.port).toBe(b?.port ?? null);
  });

  test("an abandoned start claim is cleared and start proceeds", async () => {
    const { worktree, stateDir } = freshDirs(() => sleeper());
    mkdirSync(stateDir, { recursive: true });
    // a start that crashed between locking and spawning, 2 minutes ago
    writeFileSync(
      join(stateDir, "sess-1.pid"),
      JSON.stringify({ pid: -1, startedAt: Date.now() - 120_000 }),
    );
    const status = (await startWorkspaceServer(input(worktree)))!;
    expect(status).not.toBeNull();
    expect(status.pid).toBeGreaterThan(0);
    cleanupPids.push(status.pid!);
  });

  test("streams the command's output to the log file", async () => {
    const { worktree } = freshDirs(() => sleeper("echo preview-marker && sleep 30"));
    const status = (await startWorkspaceServer(input(worktree)))!;
    cleanupPids.push(status.pid!);
    await waitFor(() => readFileSync(status.logFile, "utf-8").includes("preview-marker"));
    expect(readFileSync(status.logFile, "utf-8")).toContain("preview-marker");
  });

  test("rotates the previous run's log on restart", async () => {
    let marker = "run-one";
    const { worktree } = freshDirs(() => sleeper(`echo ${marker} && sleep 30`));

    const first = (await startWorkspaceServer(input(worktree)))!;
    cleanupPids.push(first.pid!);
    await waitFor(() => readFileSync(first.logFile, "utf-8").includes("run-one"));

    await stopWorkspaceServer("sess-1");
    marker = "run-two";
    const second = (await startWorkspaceServer(input(worktree)))!;
    cleanupPids.push(second.pid!);
    await waitFor(() => readFileSync(second.logFile, "utf-8").includes("run-two"));

    // fresh log has only the new run; the old run moved to .log.1
    expect(readFileSync(second.logFile, "utf-8")).not.toContain("run-one");
    expect(readFileSync(`${second.logFile}.1`, "utf-8")).toContain("run-one");
  });
});

describe("teardownWorkspace", () => {
  beforeEach(() => {
    _resetServerDeps();
    _resetPortDeps();
  });

  test("stops the server, releases the port, and runs the archive script", async () => {
    const { worktree } = freshDirs((dir) => ({
      scripts: { run: "sleep 30", archive: "touch archived-marker" },
      packageManager: "bun",
      source: "detected",
    }));
    const status = (await startWorkspaceServer(input(worktree)))!;
    const pid = status.pid!;
    cleanupPids.push(pid);

    await teardownWorkspace({
      sessionId: "sess-1",
      worktreePath: worktree,
      slug: "my-feature",
    });

    await expectDead(pid);
    const after = await getWorkspaceServer("sess-1");
    expect(after.port).toBeNull();
    // the committed archive script actually ran, in the worktree cwd
    await waitFor(() => existsSync(join(worktree, "archived-marker")));
    expect(existsSync(join(worktree, "archived-marker"))).toBe(true);
  });

  test("is safe when the worktree is already gone", async () => {
    const { worktree } = freshDirs(() => sleeper());
    const status = (await startWorkspaceServer(input(worktree)))!;
    cleanupPids.push(status.pid!);
    await teardownWorkspace({
      sessionId: "sess-1",
      worktreePath: join(worktree, "no-longer-exists"),
      slug: "my-feature",
    });
    expect((await getWorkspaceServer("sess-1")).running).toBe(false);
  });
});

describe("reapOrphanWorkspaces", () => {
  beforeEach(() => {
    _resetServerDeps();
    _resetPortDeps();
  });

  test("stops servers and drops ports for sessions not in the keep set", async () => {
    const { worktree } = freshDirs(() => sleeper());
    const status = (await startWorkspaceServer(input(worktree)))!;
    const pid = status.pid!;
    cleanupPids.push(pid);

    await reapOrphanWorkspaces([]);
    await expectDead(pid);
    const after = await getWorkspaceServer("sess-1");
    expect(after.running).toBe(false);
    expect(after.port).toBeNull();
  });

  test("leaves kept sessions untouched", async () => {
    const { worktree } = freshDirs(() => sleeper());
    const status = (await startWorkspaceServer(input(worktree)))!;
    const pid = status.pid!;
    cleanupPids.push(pid);

    await reapOrphanWorkspaces(["sess-1"]);
    expect(isAlive(pid)).toBe(true);
    const after = await getWorkspaceServer("sess-1");
    expect(after.running).toBe(true);
    expect(after.port).toBe(status.port);
  });
});

describe("readWorkspaceLog", () => {
  beforeEach(() => {
    _resetServerDeps();
    _resetPortDeps();
  });

  test("returns only the requested tail, not the whole file", async () => {
    const { worktree } = freshDirs(() => sleeper("seq 1 500 && sleep 30"));
    const status = (await startWorkspaceServer(input(worktree)))!;
    cleanupPids.push(status.pid!);
    await waitFor(() => readFileSync(status.logFile, "utf-8").includes("500"));

    const tail = readWorkspaceLog("sess-1", 5);
    expect(tail).toContain("500");
    expect(tail).not.toContain("494");
  });

  test("is empty for a session with no log", () => {
    freshDirs(() => sleeper());
    expect(readWorkspaceLog("never-started")).toBe("");
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

    await stopWorkspaceServer("sess-1");
    // stop resolves once the process is confirmed dead (zombie counts; reap may lag)
    await expectDead(pid);
    // stop releases the port, so status is fully cleared
    const after = await getWorkspaceServer("sess-1");
    expect(after.running).toBe(false);
    expect(after.pid).toBeNull();
    expect(after.port).toBeNull();
    expect(after.url).toBeNull();
  });

  test("escalates to SIGKILL when the group ignores SIGTERM", async () => {
    // The sh leader traps TERM and respawns its sleep forever; only KILL
    // takes it down. Short grace keeps the test fast.
    const { worktree } = freshDirs(
      () => sleeper("trap '' TERM; while :; do sleep 1; done"),
      300,
    );
    const status = (await startWorkspaceServer(input(worktree)))!;
    const pid = status.pid!;
    cleanupPids.push(pid);
    await waitFor(() => isAlive(pid));

    await stopWorkspaceServer("sess-1");
    await expectDead(pid);
  });

  test("never signals a pid it cannot verify as ours (recycled-pid guard)", async () => {
    const { worktree, stateDir } = freshDirs(() => sleeper());
    // Simulate a pre-reboot state file whose pid now belongs to someone else:
    // a live process we did NOT record spawning at that time.
    const foreign = (await startWorkspaceServer(input(worktree)))!;
    cleanupPids.push(foreign.pid!);
    writeFileSync(
      join(stateDir, "sess-1.pid"),
      JSON.stringify({ pid: foreign.pid, startedAt: 1_000 }), // "spawned" in 1970
    );

    const status = await getWorkspaceServer("sess-1");
    expect(status.running).toBe(false); // identity mismatch reads as stale

    await stopWorkspaceServer("sess-1");
    // the innocent process group was not killed
    expect(isAlive(foreign.pid!)).toBe(true);
  });

  test("is a no-op for a session that was never started", async () => {
    freshDirs(() => sleeper());
    await stopWorkspaceServer("never");
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
