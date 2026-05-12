import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type SpawnContext = {
  model: string | undefined;
  claudeVersion: string | undefined;
  git: { branch: string; sha: string; dirty: boolean } | undefined;
  cwd: string;
  // worktree: { branch: string; path: string } | undefined; // STUB — wired when worktree support lands
};

// null = not yet attempted; undefined = attempted and failed.
let cachedClaudeVersion: string | undefined | null = null;

function captureModel(): string | undefined {
  return process.env.BERTRAND_MODEL || process.env.CLAUDE_MODEL || undefined;
}

async function captureClaudeVersion(): Promise<string | undefined> {
  if (cachedClaudeVersion !== null) return cachedClaudeVersion;
  try {
    const { stdout } = await execFileAsync("claude", ["--version"], {
      timeout: 5000,
    });
    const match = stdout.trim().match(/(\d+\.\d+\.\d+(?:\.\d+)?)/);
    cachedClaudeVersion = match ? match[1] : stdout.trim() || undefined;
    return cachedClaudeVersion;
  } catch {
    cachedClaudeVersion = undefined;
    return undefined;
  }
}

async function captureGit(): Promise<SpawnContext["git"]> {
  try {
    const [statusRes, shaRes] = await Promise.all([
      execFileAsync("git", ["status", "--porcelain=v2", "--branch"], {
        timeout: 5000,
      }),
      execFileAsync("git", ["rev-parse", "HEAD"], { timeout: 5000 }),
    ]);

    let branch: string | undefined;
    let dirty = false;
    for (const line of statusRes.stdout.split("\n")) {
      if (line.startsWith("# branch.head ")) {
        branch = line.slice("# branch.head ".length).trim();
      } else if (line && !line.startsWith("#")) {
        dirty = true;
      }
    }

    if (!branch) return undefined;

    return {
      branch,
      sha: shaRes.stdout.trim(),
      dirty,
    };
  } catch {
    return undefined;
  }
}

export async function captureSpawnContext(): Promise<SpawnContext> {
  const [claudeVersion, git] = await Promise.all([
    captureClaudeVersion(),
    captureGit(),
  ]);

  return {
    model: captureModel(),
    claudeVersion,
    git,
    cwd: process.cwd(),
  };
}
