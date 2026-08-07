import { describe, test, expect } from "bun:test";
import { spawn } from "child_process";
import {
  isFreshClaim,
  isProcessAlive,
  isRecordedProcessAlive,
  parseEtimeMs,
  verifyPidIdentity,
} from "./process-identity";

/** A pid that is essentially certain not to exist. */
const DEAD_PID = 2_147_483_600;

describe("parseEtimeMs", () => {
  test("mm:ss", () => {
    expect(parseEtimeMs("00:05")).toBe(5_000);
    expect(parseEtimeMs("01:30")).toBe(90_000);
  });

  test("hh:mm:ss", () => {
    expect(parseEtimeMs("01:00:00")).toBe(3_600_000);
  });

  test("dd-hh:mm:ss", () => {
    expect(parseEtimeMs("2-00:00:00")).toBe(2 * 24 * 3_600_000);
  });

  test("tolerates surrounding whitespace", () => {
    expect(parseEtimeMs("  00:10 ")).toBe(10_000);
  });

  test("returns null for unparseable input", () => {
    expect(parseEtimeMs("")).toBeNull();
    expect(parseEtimeMs("garbage")).toBeNull();
  });
});

describe("isFreshClaim", () => {
  test("a claim from moments ago is fresh", () => {
    expect(isFreshClaim(Date.now())).toBe(true);
  });

  test("an old claim is not", () => {
    expect(isFreshClaim(Date.now() - 120_000)).toBe(false);
  });

  test("a missing timestamp is never fresh", () => {
    expect(isFreshClaim(null)).toBe(false);
  });
});

describe("isProcessAlive", () => {
  test("our own process is alive", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  test("an unused pid is not", () => {
    expect(isProcessAlive(DEAD_PID)).toBe(false);
  });
});

describe("verifyPidIdentity", () => {
  test("accepts our own pid when the recorded start time matches", async () => {
    // This process started before now; ±120s of slack covers the test run.
    expect(await verifyPidIdentity(process.pid, Date.now())).toBe(true);
  });

  test("rejects our own pid when the recorded start time doesn't match", async () => {
    // The recycling case: the number is live, but it isn't the process we
    // recorded a week ago.
    const aWeekAgo = Date.now() - 7 * 24 * 3_600_000;
    expect(await verifyPidIdentity(process.pid, aWeekAgo)).toBe(false);
  });

  test("rejects a pid that no longer exists", async () => {
    expect(await verifyPidIdentity(DEAD_PID, Date.now())).toBe(false);
  });

  test("skips the start-time check when no timestamp was recorded", async () => {
    expect(await verifyPidIdentity(process.pid, null)).toBe(true);
  });

  test("requireGroupLeader accepts a detached child, rejects a plain one", async () => {
    // Detached children get their own process group (pgid == pid) — this is
    // the shape the workspace registry spawns and group-kills.
    const leader = spawn("sleep", ["5"], { detached: true, stdio: "ignore" });
    // A plain child inherits our group, so it is NOT a leader. Session pids
    // can look like this, which is why the option must stay off for them.
    const follower = spawn("sleep", ["5"], { stdio: "ignore" });
    try {
      expect(
        await verifyPidIdentity(leader.pid!, null, { requireGroupLeader: true }),
      ).toBe(true);
      expect(
        await verifyPidIdentity(follower.pid!, null, { requireGroupLeader: true }),
      ).toBe(false);
      // Without the option, both are simply "alive and ours".
      expect(await verifyPidIdentity(follower.pid!, null)).toBe(true);
    } finally {
      leader.kill("SIGKILL");
      follower.kill("SIGKILL");
    }
  });
});

describe("isRecordedProcessAlive", () => {
  test("a dead pid is dead regardless of timestamp", async () => {
    expect(await isRecordedProcessAlive(DEAD_PID, Date.now())).toBe(false);
    expect(await isRecordedProcessAlive(DEAD_PID, null)).toBe(false);
  });

  test("a live pid recorded moments ago is trusted without probing", async () => {
    expect(await isRecordedProcessAlive(process.pid, Date.now())).toBe(true);
  });

  test("a recycled pid does not pass as the recorded process", async () => {
    // The #209 failure mode: the row's pid is live again as something else.
    // A bare kill(pid, 0) would call this alive and the row would never be
    // recovered.
    const aWeekAgo = Date.now() - 7 * 24 * 3_600_000;
    expect(await isRecordedProcessAlive(process.pid, aWeekAgo)).toBe(false);
  });

  test("a legacy row with no timestamp falls back to liveness only", async () => {
    expect(await isRecordedProcessAlive(process.pid, null)).toBe(true);
  });
});
