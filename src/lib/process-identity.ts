import { execFile } from "child_process";

/**
 * Shared PID-identity checks (issue #209).
 *
 * A recorded pid is not proof the same process is still running: pids get
 * recycled, and a stale record that survives a reboot can point at an
 * unrelated process that inherited the number. Every caller that treats a
 * stored pid as meaningful — the workspace preview registry, session recovery
 * — needs the same guard, so it lives here rather than in either of them.
 *
 * The signal is the process start time, derived as `now − etime`. Elapsed time
 * is TZ-independent, unlike `lstart`'s wall-clock string, which makes it the
 * cheap portable answer.
 */

/** Parse ps's etime format `[[dd-]hh:]mm:ss` into milliseconds. */
export function parseEtimeMs(etime: string): number | null {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(etime.trim());
  if (!m) return null;
  const [, dd, hh, mm, ss] = m;
  return (
    (((Number(dd ?? 0) * 24 + Number(hh ?? 0)) * 60 + Number(mm)) * 60 +
      Number(ss)) *
    1000
  );
}

/** Liveness only — says nothing about whether it's still *our* process. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * A claim recorded moments ago is trusted without probing the OS. PID
 * recycling needs a reboot or a full pid-space wraparound — neither happens
 * within a minute of us writing the claim — and for claims this fresh the
 * etime check is vacuous anyway (its ±120s tolerance always passes). Probing
 * would be all downside: `ps` can transiently fail under fork pressure, and a
 * just-spawned detached child may not have applied setsid yet (Linux does the
 * child-side setup after fork), so a live fresh pid can flunk the
 * group-leader check. A false negative is not harmless — callers act on it by
 * dropping state or reaping a session that is very much alive.
 */
export function isFreshClaim(startedAt: number | null): boolean {
  return startedAt != null && Date.now() - startedAt < 60_000;
}

export interface VerifyPidOptions {
  /**
   * Also require that the pid leads its own process group.
   *
   * Only meaningful for processes we deliberately spawned detached and later
   * signal as a group — the workspace preview servers. It must stay OFF for
   * session pids: the CLI records its own `process.pid`, which is a group
   * leader when a shell runs it as a simple foreground command but *not* in a
   * pipeline (`bertrand launch | tee`), where the first process leads. A live
   * session would flunk the check and be reaped as dead.
   */
  requireGroupLeader?: boolean;
  /**
   * How far the observed process start may sit from the recorded one. etime
   * has second precision and clocks drift, so some slack is required; the
   * default is still far tighter than any realistic pid-recycling window.
   */
  toleranceMs?: number;
}

/**
 * Is `pid` still the process we recorded at `startedAt`?
 *
 * An unverifiable pid is treated as NOT ours. The failure mode is then a stale
 * record we clean up, never a signal delivered into an innocent process.
 */
export function verifyPidIdentity(
  pid: number,
  startedAt: number | null,
  opts: VerifyPidOptions = {},
): Promise<boolean> {
  const { requireGroupLeader = false, toleranceMs = 120_000 } = opts;
  return new Promise((resolve) => {
    execFile("ps", ["-o", "pgid=,etime=", "-p", String(pid)], (err, stdout) => {
      if (err) return resolve(false); // process gone
      const m = /^(\d+)\s+(\S+)$/.exec(stdout.trim());
      if (!m) return resolve(false);
      if (requireGroupLeader && Number(m[1]) !== pid) return resolve(false);
      if (startedAt != null) {
        const elapsed = parseEtimeMs(m[2]!);
        if (elapsed != null) {
          const processStart = Date.now() - elapsed;
          if (Math.abs(processStart - startedAt) > toleranceMs) {
            return resolve(false);
          }
        }
      }
      resolve(true);
    });
  });
}

/**
 * The question callers actually have: is the process we recorded still
 * running? Combines the cheap liveness probe with the identity check, and
 * short-circuits on a fresh claim.
 *
 * A null `startedAt` means the record predates identity tracking (or came
 * from a path that doesn't set it). Identity then degrades to bare liveness —
 * the pre-#209 behavior — rather than declaring every legacy row dead.
 */
export async function isRecordedProcessAlive(
  pid: number,
  startedAt: number | null,
  opts: VerifyPidOptions = {},
): Promise<boolean> {
  if (!isProcessAlive(pid)) return false;
  if (isFreshClaim(startedAt)) return true;
  if (startedAt == null) return true;
  return verifyPidIdentity(pid, startedAt, opts);
}
