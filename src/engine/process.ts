import { markContractSent } from "@/hooks/runtime";
import { byteLength, logContextDelivery } from "@/contract/layers";
import { spawnPty, type PtyHandle } from "./pty";

export interface ClaudeLaunchOpts {
  sessionId: string;
  claudeId: string;
  sessionName: string;
  sessionSlug: string;
  contract: string;
  resume?: boolean;
}

/** Currently running Claude PTY, if any. */
let activePty: PtyHandle | null = null;

/**
 * The environment the `claude` child is spawned with: **the whole of
 * bertrand's own environment**, plus the `BERTRAND_*` vars identifying this
 * session.
 *
 * The `...process.env` spread is load-bearing and must never become an
 * allowlist. Everything downstream inherits through the chain
 * bertrand → claude → hook subprocess → `bertrand update`, so it is the only
 * reason a host's variables survive the launch at all: `ORCA_*` is what made
 * bertrand and Orca compose without either knowing about the other
 * (docs/orca-boundary.md), and any comparable host goes blind to
 * bertrand-launched sessions the moment this is narrowed. bertrand's own
 * `BERTRAND_*` vars ride the same channel.
 *
 * There are four of them now rather than six. `BERTRAND_PROJECT` and
 * `BERTRAND_PROJECT_DB` pinned the active project (and its SQLite file) at
 * spawn time so a `bertrand project switch` in another terminal could not
 * redirect a running session's writes. With one database at `paths.db` there
 * is nothing to pin, and grouping is a column derived from the session's cwd.
 *
 * Extracted from `launchClaude` so `process.test.ts` can assert the
 * passthrough without spawning `claude`.
 */
export function buildClaudeEnv(
  opts: Pick<ClaudeLaunchOpts, "sessionId" | "claudeId" | "sessionName" | "sessionSlug">,
) {
  return {
    ...process.env,
    BERTRAND_CLAUDE_ID: opts.claudeId,
    BERTRAND_SESSION: opts.sessionId,
    BERTRAND_SESSION_NAME: opts.sessionName,
    BERTRAND_SESSION_SLUG: opts.sessionSlug,
  };
}

/**
 * Hand `claude` the full contract as a system prompt — and, on a fresh launch,
 * record the hand-off. The marker write is the point of this function, hence
 * the verb: call it only on the path that really spawns.
 *
 * The UserPromptSubmit hook re-delivers the full contract on a conversation's
 * first prompt unless the `contract-sent` marker says it already arrived — the
 * re-delivery exists for claudes bertrand didn't spawn. Without the marker a
 * launched conversation carried the ~9KB contract twice: once here, once more
 * in its first prompt's context (docs/context-budget.md). The marker is keyed
 * by `claudeId` because that is the `BERTRAND_CLAUDE_ID` the hook's `cid` reads
 * on this path (see buildClaudeEnv).
 *
 * Never marked on `--resume`: claude ignores `--append-system-prompt` when
 * resuming (Claude Code 2.1.289, verified 2026-10-05), so there the hook's
 * re-delivery is the only copy the conversation gets. Best-effort: a marker
 * that can't be written costs a duplicate contract, never the launch.
 */
export function deliverContract(
  claudeId: string,
  contract: string,
  resume: boolean,
): string[] {
  if (!resume) {
    try {
      markContractSent(claudeId);
    } catch {
      // Fall back to the hook's first-prompt re-delivery.
    }
    // Logged only when it lands: on --resume this copy never reaches the model.
    logContextDelivery({
      conversationId: claudeId,
      delivery: "argv",
      bytes: byteLength(contract),
    });
  }
  return ["--append-system-prompt", contract];
}

/**
 * Spawn a Claude Code subprocess attached to a PTY bertrand owns (instead of
 * `stdio: "inherit"`), with the appropriate flags and env vars. The local
 * terminal is wired up as one consumer of that PTY (raw-mode passthrough on
 * stdin, resize forwarding).
 *
 * Behavior change from `stdio: "inherit"`: Ctrl+C at the real terminal used
 * to signal the `claude` child directly, since it owned the controlling
 * terminal. Now bertrand's own stdin is in raw mode, which suppresses local
 * SIGINT generation — Ctrl+C arrives as a literal 0x03 byte and is forwarded
 * through the PTY, where `claude`'s own termios turns it into SIGINT for
 * itself. Net effect on `claude` is the same; the SIGINT/SIGTERM forwarding
 * below now mainly covers external signals (e.g. `kill -TERM <bertrand-pid>`)
 * rather than the common interactive Ctrl+C path.
 */
export function launchClaude(opts: ClaudeLaunchOpts): Promise<number> {
  const args: string[] = [];

  if (opts.resume) {
    args.push("--resume", opts.claudeId);
  } else {
    args.push("--session-id", opts.claudeId);
  }

  args.push(...deliverContract(opts.claudeId, opts.contract, !!opts.resume));

  const env = buildClaudeEnv(opts);

  return new Promise((resolve, reject) => {
    let pty: PtyHandle;
    try {
      pty = spawnPty(["claude", ...args], {
        env,
        cols: process.stdout.columns,
        rows: process.stdout.rows,
        onData: (chunk) => process.stdout.write(chunk),
      });
    } catch (err) {
      reject(new Error(`Failed to launch claude: ${(err as Error).message}`));
      return;
    }

    activePty = pty;

    // Local terminal is one consumer of the PTY: raw stdin bytes forward
    // straight through, and resize follows the real terminal's dimensions.
    const stdinIsTty = process.stdin.isTTY === true;
    const onStdinData = (chunk: Buffer) => pty.write(chunk);
    process.stdin.on("data", onStdinData);
    process.stdin.resume();
    if (stdinIsTty) process.stdin.setRawMode(true);

    const onResize = () => {
      const { columns, rows } = process.stdout;
      if (!columns || !rows) return;
      try {
        pty.resize(columns, rows);
      } catch {
        // Session already exited; there is nothing left to resize.
      }
    };
    if (process.stdout.isTTY) process.stdout.on("resize", onResize);

    // Forward signals to the child — let Claude handle its own graceful shutdown.
    // Prevent bertrand from exiting before cleanup runs.
    const onSignal = (signal: NodeJS.Signals) => pty.kill(signal);
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    const cleanup = () => {
      process.stdin.removeListener("data", onStdinData);
      if (stdinIsTty) process.stdin.setRawMode(false);
      process.stdin.pause();
      if (process.stdout.isTTY) process.stdout.removeListener("resize", onResize);
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
      activePty = null;
    };

    pty.exited.then(
      (code) => {
        cleanup();
        resolve(code);
      },
      (err) => {
        cleanup();
        reject(err);
      },
    );
  });
}

/**
 * Returns true while a Claude PTY is still attached — from spawn until
 * `pty.exited` resolves and clears activePty. Stays true after pty.kill(),
 * since the process keeps running until it actually exits. Callers that want
 * to coordinate with launchClaude's signal forwarder must use this looser
 * check, not a "kill already called" flag.
 */
export function isClaudeRunning(): boolean {
  return activePty !== null;
}
