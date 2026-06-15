import { spawn, type ChildProcess } from "child_process";
import { resolveActiveProject } from "@/lib/projects/resolve";

export interface ClaudeLaunchOpts {
  sessionId: string;
  claudeId: string;
  sessionName: string;
  sessionSlug: string;
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

/**
 * Returns true while a Claude subprocess is still attached — from spawn
 * until child.on("exit") clears activeChild. Stays true after child.kill(),
 * since the .killed flag flips on the signal call but the process keeps
 * running until it actually exits. Callers that want to coordinate with
 * launchClaude's signal forwarder must use this looser check, not .killed.
 */
export function isClaudeRunning(): boolean {
  return activeChild !== null;
}
