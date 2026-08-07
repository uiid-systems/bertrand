import { resolveActiveProject } from "@/lib/projects/resolve";
import { smallestDims, spawnPty, type PtyDims, type PtyHandle } from "./pty";
import { connectTerminalRelay, type TerminalRelayClient } from "./terminal-relay-client";

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
    BERTRAND_CLAUDE_ID: opts.claudeId,
    BERTRAND_SESSION: opts.sessionId,
    BERTRAND_SESSION_NAME: opts.sessionName,
    BERTRAND_SESSION_SLUG: opts.sessionSlug,
    BERTRAND_PROJECT: active.slug,
    BERTRAND_PROJECT_DB: active.db,
  };

  return new Promise((resolve, reject) => {
    let pty: PtyHandle;
    let relay: TerminalRelayClient | null = null;
    try {
      pty = spawnPty(["claude", ...args], {
        env,
        cols: process.stdout.columns,
        rows: process.stdout.rows,
        onData: (chunk) => {
          process.stdout.write(chunk);
          relay?.send(chunk);
        },
      });
    } catch (err) {
      reject(new Error(`Failed to launch claude: ${(err as Error).message}`));
      return;
    }

    activePty = pty;

    const localDims = () => ({
      cols: process.stdout.columns ?? 80,
      rows: process.stdout.rows ?? 24,
    });

    /**
     * Geometry a dashboard browser has taken over, or null when none has. Held
     * here rather than in the relay so the PTY's size is always decided in one
     * place, by the process that owns it.
     */
    let browserClaim: PtyDims | null = null;

    /** The size to actually give the PTY — see smallestDims(). */
    const currentDims = () => smallestDims(localDims(), browserClaim);

    /** Resizes the PTY and tells attached browsers what actually took effect. */
    const applyDims = () => {
      const { cols, rows } = currentDims();
      if (cols < 1 || rows < 1) return;
      try {
        pty.resize(cols, rows);
      } catch {
        // Session already exited; there is nothing left to resize.
        return;
      }
      relay?.sendDims(cols, rows);
    };

    // A dashboard browser is a second consumer of the same PTY, symmetric with
    // the local terminal below for input — both just call pty.write(). Geometry
    // is negotiated rather than owned: this side stays the authority on what the
    // PTY's size actually is (and reports it via sendDims), but a browser can
    // ask to take sizing over so the terminal fits the panel it is rendered in.
    relay = connectTerminalRelay({
      sessionId: opts.sessionId,
      onInput: (chunk) => pty.write(chunk),
      onSetSize: (dims) => {
        browserClaim = dims;
        applyDims();
      },
      // A browser attaching mid-session missed the output that drew the current
      // screen. Two resizes in quick succession read as a real terminal resize,
      // which makes the TUI repaint its whole frame.
      onRepaint: () => {
        const { cols, rows } = currentDims();
        try {
          pty.resize(cols, Math.max(1, rows - 1));
          setTimeout(() => {
            try {
              pty.resize(cols, rows);
            } catch {
              // Session exited between the two resizes — nothing to repaint.
            }
          }, 50);
        } catch {
          // Session already exited; a repaint request is moot.
        }
      },
    });
    const initialDims = currentDims();
    relay.sendDims(initialDims.cols, initialDims.rows);

    // Local terminal is one consumer of the PTY: raw stdin bytes forward
    // straight through, and resize follows the real terminal's dimensions.
    const stdinIsTty = process.stdin.isTTY === true;
    const onStdinData = (chunk: Buffer) => pty.write(chunk);
    process.stdin.on("data", onStdinData);
    process.stdin.resume();
    if (stdinIsTty) process.stdin.setRawMode(true);

    // Resizing the local terminal re-derives the effective size (a browser may
    // still be claiming a smaller one) and tells attached browsers the result.
    const onResize = () => {
      if (process.stdout.columns && process.stdout.rows) applyDims();
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
      relay?.close();
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
