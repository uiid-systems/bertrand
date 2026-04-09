import { spawn } from "child_process";

export interface ClaudeLaunchOpts {
  sessionId: string;
  claudeId: string;
  sessionName: string;
  contract: string;
  resume?: boolean;
}

/**
 * Spawn a Claude Code subprocess with the appropriate flags and env vars.
 * Returns a promise that resolves when the process exits.
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

    child.on("error", (err) => {
      reject(new Error(`Failed to launch claude: ${err.message}`));
    });

    child.on("exit", (code) => {
      resolve(code ?? 0);
    });
  });
}
