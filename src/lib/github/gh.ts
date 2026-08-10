/**
 * The `gh` transport: every GitHub call bertrand makes goes through here.
 *
 * `gh` rather than a REST client is the load-bearing decision. It inherits the
 * user's existing `gh auth`, which means bertrand stores no token, registers no
 * OAuth app, and refreshes nothing — the entire credential problem belongs to a
 * tool the user already trusts on this machine.
 *
 * The costs of that choice are what this module exists to absorb: a subprocess
 * per call, which is why there is a concurrency cap; a binary that may not be
 * installed, which is why absence is a result and not a crash; and failures
 * that arrive as text on stderr, which is why `./errors` classifies them.
 */
import type { Subprocess } from "bun";

import { isDeclaredHost } from "./hosts";
import {
  classifyExit,
  classifySpawnError,
  ghFailure,
  type GhResult,
} from "./errors";

export type { GhFailure, GhFailureReason, GhResult } from "./errors";

/**
 * At most four `gh` processes at once.
 *
 * The dashboard polls, and a poll fans out over every project, so the natural
 * shape of this workload is a burst. Uncapped, a burst spawns a process per
 * project and the machine spends more time forking than the results are worth;
 * worse, GitHub answers a wide enough burst with a secondary rate limit, which
 * is the failure this cap is really buying insurance against.
 */
export const MAX_CONCURRENT_GH = 4;

/**
 * How long a single `gh` call gets before it is killed.
 *
 * A cap without a timeout is a deadlock: one `gh` blocked on a hung connection
 * holds its slot forever, and four of them stop the feature permanently. Ten
 * seconds is far past any healthy API call and far short of a user noticing.
 */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * How long a missing `gh` is remembered.
 *
 * Absence is stable and re-checking it is pure waste — on a polling path, every
 * miss is another failed spawn for a binary that is still not there. Matching
 * the negative TTL in `./resolve`, and for the same reason: the fix (install
 * `gh`) takes effect within a window, not instantly, which is the same wait as
 * every other configuration fix in this layer.
 */
const GH_MISSING_TTL_MS = 5 * 60_000;

/** A single `gh` invocation, as handed to the runner. */
export interface GhInvocation {
  args: string[];
  cwd?: string;
  /** GitHub Enterprise Server host. Undefined means github.com. */
  host?: string;
  timeoutMs: number;
}

/**
 * What became of a `gh` process. Three arms rather than a throwing runner,
 * because a test needs to stage "the binary is missing" and "the call hung"
 * as easily as it stages a non-zero exit.
 */
export type GhOutcome =
  | { kind: "exited"; exitCode: number; stdout: string; stderr: string }
  | { kind: "spawn-failed"; error: unknown }
  | { kind: "timed-out" };

/** Runs one `gh` process. The only part of this module that touches the OS. */
export type GhRunner = (invocation: GhInvocation) => Promise<GhOutcome>;

/** Where `gh` talks when no enterprise host is named. */
const GITHUB_COM = "github.com";

/**
 * Environment for a `gh` child. Exported for tests.
 *
 * The ambient environment is inherited because that is the whole point of this
 * transport — `GH_TOKEN` and `gh`'s config are the user's credentials, and
 * bertrand wants them.
 *
 * `GH_HOST` is the exception, and it is always written. Inheriting it would
 * route a call the caller meant for github.com to whatever host happened to be
 * exported in the shell that started bertrand — a host the gate in
 * {@link runGh} never saw and never approved. Pinning it makes the destination
 * a decision this module made rather than one it absorbed.
 *
 * The rest defend the classifier and the concurrency cap: prompts are disabled
 * because nothing is attached to answer one, and a `gh` blocked on input holds
 * a slot until the timeout fires; the update notifier and color codes are
 * suppressed because both land on stderr, which is the text
 * {@link classifyExit} reads.
 */
export function _ghEnv(host?: string): Record<string, string | undefined> {
  return {
    ...process.env,
    GH_HOST: host ?? GITHUB_COM,
    GH_PROMPT_DISABLED: "1",
    GH_NO_UPDATE_NOTIFIER: "1",
    NO_COLOR: "1",
  };
}

const defaultGhRunner: GhRunner = async ({ args, cwd, host, timeoutMs }) => {
  // Spelled out rather than inferred: the stdio shape below is what makes
  // `proc.stdout` a stream, and declaring it here keeps that guarantee from
  // being erased when the handle escapes the `try`.
  let proc: Subprocess<"ignore", "pipe", "pipe">;

  try {
    proc = Bun.spawn(["gh", ...args], {
      cwd,
      env: _ghEnv(host),
      // Nothing may read from the terminal: bertrand runs this from a server.
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    return { kind: "spawn-failed", error };
  }

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);

  try {
    // Drained alongside `exited`, never after it. A `gh` that writes more than
    // a pipe buffer blocks until someone reads, and awaiting exit first would
    // wait for a process that is itself waiting for us.
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    return timedOut ? { kind: "timed-out" } : { kind: "exited", exitCode, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
};

let runner: GhRunner = defaultGhRunner;
let now: () => number = Date.now;

/** Set when `gh` is known absent; suppresses spawns until it expires. */
let ghMissingUntil = 0;

let active = 0;
const waiting: (() => void)[] = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT_GH) {
    active++;
    return Promise.resolve();
  }

  return new Promise<void>((admit) => {
    waiting.push(admit);
  });
}

function release(): void {
  const next = waiting.shift();

  if (next) {
    // Hand the slot straight to the next waiter rather than freeing and
    // re-taking it. `active` never dips, so a caller arriving in the gap
    // cannot slip past the cap ahead of someone already queued.
    next();
  } else {
    active--;
  }
}

/**
 * Run `gh` and return its stdout.
 *
 * Never throws. Every failure — no binary, no auth, no network, a hung call —
 * comes back as a typed {@link GhResult}, because the dashboard asks this on a
 * poll and an exception there blanks a UI over a condition that clears itself.
 *
 * `host` is checked against this machine's declared GitHub Enterprise Server
 * hosts before anything is spawned. A stored binding can name a host that was
 * declared when it was written and is not declared now, and `gh` would dial it
 * without complaint — so the host that reaches `GH_HOST` is one this machine
 * still vouches for, or no process runs at all.
 */
export async function runGh(
  args: string[],
  options: { cwd?: string; host?: string; timeoutMs?: number } = {},
): Promise<GhResult<string>> {
  const { cwd, host, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  // Undefined is github.com, trusted by definition; skipping the call keeps
  // the common path off the disk that backs the declared-host list.
  if (host !== undefined && !isDeclaredHost(host)) {
    return ghFailure(
      "untrusted-host",
      `Refusing to run gh against ${host}: not a declared GitHub Enterprise Server host.`,
    );
  }

  if (ghMissingUntil > now()) {
    return ghFailure("gh-missing");
  }

  await acquire();

  let outcome: GhOutcome;

  try {
    outcome = await runner({ args, cwd, host, timeoutMs });
  } catch (error) {
    // The contract says a runner resolves rather than rejects. Honor the
    // never-throws promise anyway: a runner that breaks it is still a `gh`
    // failure, not a crash in whatever was polling.
    outcome = { kind: "spawn-failed", error };
  } finally {
    release();
  }

  if (outcome.kind === "timed-out") {
    return ghFailure(
      "timed-out",
      `\`gh ${args.join(" ")}\` did not finish within ${timeoutMs}ms.`,
    );
  }

  if (outcome.kind === "spawn-failed") {
    const reason = classifySpawnError(outcome.error);

    if (reason === "gh-missing") {
      ghMissingUntil = now() + GH_MISSING_TTL_MS;
    }

    return ghFailure(
      reason,
      outcome.error instanceof Error ? outcome.error.message : undefined,
    );
  }

  if (outcome.exitCode === 0) {
    return { ok: true, value: outcome.stdout.trim() };
  }

  return ghFailure(
    classifyExit(outcome.exitCode, outcome.stderr),
    outcome.stderr,
    outcome.exitCode,
  );
}

/** Longest fragment of unparseable stdout worth putting in a message. */
const PREVIEW_LENGTH = 120;

/**
 * Run `gh` and parse its stdout as JSON.
 *
 * The type parameter is a claim about what the command returns, not a checked
 * fact — this parses, it does not validate. Callers asking for a shape they
 * are not sure of should narrow it themselves.
 */
export async function runGhJson<T>(
  args: string[],
  options: { cwd?: string; host?: string; timeoutMs?: number } = {},
): Promise<GhResult<T>> {
  const result = await runGh(args, options);

  if (!result.ok) {
    return result;
  }

  try {
    return { ok: true, value: JSON.parse(result.value) as T };
  } catch {
    // Truncated on purpose: a `gh` pointed at a captive portal answers with a
    // whole HTML page, and none of it belongs in a message a user reads.
    const preview = result.value.slice(0, PREVIEW_LENGTH);

    return ghFailure(
      "invalid-json",
      preview ? `Expected JSON from \`gh ${args.join(" ")}\`, got: ${preview}` : undefined,
    );
  }
}

/** Swap the `gh` subprocess runner. Pass null to restore the real one. */
export function _setGhRunner(run: GhRunner | null): void {
  runner = run ?? defaultGhRunner;
}

/** Swap the clock behind the missing-`gh` memo, so expiry is testable. */
export function _setClock(clock: (() => number) | null): void {
  now = clock ?? Date.now;
}

/** Forget that `gh` was missing, and drop any slots a failed test left held. */
export function _resetGhState(): void {
  ghMissingUntil = 0;
  active = 0;
  waiting.length = 0;
}
