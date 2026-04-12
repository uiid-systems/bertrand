import { spawn, type ChildProcess } from "child_process";

export interface ClaudeLaunchOpts {
  sessionId: string;
  claudeId: string;
  sessionName: string;
  contract: string;
  resume?: boolean;
}

/** Currently running Claude subprocess, if any. */
let activeChild: ChildProcess | null = null;

/**
 * Spawn a Claude Code subprocess with the appropriate flags and env vars.
 * Registers signal handlers to forward SIGINT/SIGTERM to the child and
 * waits for it to exit before resolving.
 */
export function launchClaude(opts: ClaudeLaunchOpts): Promise<number> {
  const args: string[] = [];

  if (opts.resume) {
    args.push("--resume", opts.claudeId);
  } else {
    args.push("--session-id", opts.claudeId);
  }

  args.push("--append-system-prompt", opts.contract);

  const env = {
    ...process.env,
    BERTRAND_PID: String(process.pid),
    BERTRAND_CLAUDE_ID: opts.claudeId,
    BERTRAND_SESSION: opts.sessionId,
  };

  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      env,
      stdio: "inherit",
      shell: false,
    });

    activeChild = child;

    // Forward signals to the child — let Claude handle its own graceful shutdown.
    // Prevent bertrand from exiting before cleanup runs.
    const onSignal = (signal: NodeJS.Signals) => {
      if (child.pid && !child.killed) {
        child.kill(signal);
      }
    };

    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    child.on("error", (err) => {
      activeChild = null;
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
      reject(new Error(`Failed to launch claude: ${err.message}`));
    });

    child.on("exit", (code) => {
      activeChild = null;
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
      resolve(code ?? 0);
    });
  });
}

/** Returns true if a Claude subprocess is currently running. */
export function isClaudeRunning(): boolean {
  return activeChild !== null && !activeChild.killed;
}
