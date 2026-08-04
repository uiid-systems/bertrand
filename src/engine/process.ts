import { resolveActiveProject } from "@/lib/projects/resolve";
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
 * Spawn a Claude Code subprocess attached to a PTY bertrand owns (instead of
 * `stdio: "inherit"`), with the appropriate flags and env vars. The local
 * terminal is wired up as one consumer of that PTY (raw-mode passthrough on
 * stdin, resize forwarding) — see docs/pty-wrapper.md for why this is the
 * seam a browser consumer attaches to later without changing this function.
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

  args.push("--append-system-prompt", opts.contract);

  // Capture the active project at spawn time so the running session keeps
  // writing to the right DB even if the user runs `bertrand project switch`
  // in another terminal. Hooks inherit this env via the chain
  // bertrand → claude → hook subprocess → bertrand update, so every
  // hook-triggered write resolves to the same project the session started
  // in — not whatever's active on disk at hook-fire time.
  const active = resolveActiveProject();

  const env = {
    ...process.env,
    BERTRAND_PID: String(process.pid),
    BERTRAND_CLAUDE_ID: opts.claudeId,
    BERTRAND_SESSION: opts.sessionId,
    BERTRAND_SESSION_NAME: opts.sessionName,
    BERTRAND_SESSION_SLUG: opts.sessionSlug,
    BERTRAND_PROJECT: active.slug,
    BERTRAND_PROJECT_DB: active.db,
  };

  return new Promise((resolve, reject) => {
    let pty: PtyHandle;
    try {
      pty = spawnPty(["claude", ...args], {
        env,
        cols: process.stdout.columns,
        rows: process.stdout.rows,
        onData: (chunk) => {
          process.stdout.write(chunk);
        },
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
      if (process.stdout.columns && process.stdout.rows) {
        pty.resize(process.stdout.columns, process.stdout.rows);
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
