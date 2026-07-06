import { execFile } from "child_process";
import { existsSync } from "fs";
import { register } from "@/cli/router";
import { resolveSessionByName } from "@/db/queries/sessions";
import { getMainWorktree } from "@/lib/git";
import {
  startWorkspaceServer,
  getWorkspaceServer,
} from "@/lib/workspace";

/** Probe the preview port until it answers or the timeout elapses. */
async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(500) });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return false;
}

/** Open a URL in the user's default browser. Best-effort, platform-aware. */
function openInBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  execFile(cmd, [url], () => {
    // Best-effort: the URL is always printed, so a failure here isn't fatal.
  });
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/**
 * `bertrand open <session>` — lazily start the session's worktree dev server
 * and open its preview URL. This is the Phase 1 payoff: see a branch running
 * without ever cd-ing into the worktree.
 *
 * Lazy by design (docs/workspaces.md): nothing auto-starts on worktree entry;
 * this command (and the dashboard's start button) are the only triggers.
 */
register("open", async (args) => {
  const name = args.find((a) => !a.startsWith("-"));
  if (!name) fail("Usage: bertrand open <category>/<slug>");

  let resolved;
  try {
    resolved = resolveSessionByName(name!);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  if (!resolved) fail(`Unknown session: ${name}`);

  const { session, slug } = resolved!;
  const worktreePath = session.worktreePath;
  if (!worktreePath) {
    fail(
      `Session ${name} isn't working in a worktree yet — previews are only ` +
        `available once a session enters one for git-bound work.`,
    );
  }
  if (!existsSync(worktreePath!)) {
    fail(`Worktree path no longer exists: ${worktreePath}`);
  }

  const alreadyRunning = getWorkspaceServer(session.id).running;
  const root = await getMainWorktree(worktreePath!);
  const status = startWorkspaceServer({
    sessionId: session.id,
    worktreePath: worktreePath!,
    root,
    slug,
  });

  if (!status) {
    fail(
      `No dev command found in ${worktreePath}. Add a "dev" script to ` +
        `package.json, or a "run" command in .bertrand/config.json.`,
    );
  }
  const { port, url, logFile } = status!;
  // startWorkspaceServer always allocates a port on success; this guard is a
  // belt-and-braces narrow for the type, not an expected runtime path.
  if (port == null || url == null) {
    fail("Internal error: workspace server started without a port.");
  }

  console.log(`Preview: ${url}`);
  console.log(`Logs:    ${logFile}`);

  // Freshly started servers need a moment to bind; poll before opening so the
  // browser doesn't land on a connection-refused. An already-running server
  // opens immediately.
  if (!alreadyRunning) {
    process.stdout.write("Starting dev server…");
    const ready = await waitForPort(port!, 20_000);
    console.log(ready ? " ready." : " still starting (tail the logs above).");
  }

  openInBrowser(url!);
});
