import { execFile } from "child_process";
import { existsSync } from "fs";
import { register } from "@/cli/router";
import { resolveSessionByName } from "@/db/queries/sessions";
import { getMainWorktree } from "@/lib/git";
import {
  startWorkspaceServer,
  getWorkspaceServer,
  type WorkspaceServerStatus,
} from "@/lib/workspace";

/**
 * Poll the session's status until its process group is observed listening,
 * the process dies, or the timeout elapses. Returns null when the process
 * exited (a failed `setup`, a crashed server) — callers must not open a
 * browser on that path. A non-null, non-listening result means "still
 * starting" when it ran out the clock.
 */
async function waitForListening(
  sessionId: string,
  timeoutMs: number,
): Promise<WorkspaceServerStatus | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await getWorkspaceServer(sessionId);
    if (!status.running) return null;
    if (status.listening) return status;
    await new Promise((r) => setTimeout(r, 300));
  }
  return getWorkspaceServer(sessionId);
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
 *
 * The browser only opens on an *observed* listening port — never on the
 * assumption that the app honored `PORT`. If the app bound a different port
 * (Vite ignores `PORT`; some scripts pin their own), the preview follows the
 * real port and says so.
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

  const alreadyRunning = (await getWorkspaceServer(session.id)).running;
  const root = await getMainWorktree(worktreePath!);
  const status = await startWorkspaceServer({
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
  const { port, logFile } = status!;
  // startWorkspaceServer always allocates a port on success; this guard is a
  // belt-and-braces narrow for the type, not an expected runtime path.
  if (port == null) {
    fail("Internal error: workspace server started without a port.");
  }

  console.log(`Logs: ${logFile}`);
  process.stdout.write(alreadyRunning ? "Checking dev server…" : "Starting dev server…");

  // Fresh servers get time to install + bind; a pre-existing one should
  // already be listening, so a short check suffices to catch a wedged process.
  const final = await waitForListening(session.id, alreadyRunning ? 5_000 : 30_000);

  if (final === null) {
    console.log(" it exited during startup.");
    fail(`The dev server died before binding a port — check the logs: ${logFile}`);
  }
  if (!final.listening) {
    console.log(" still not listening.");
    fail(
      `Nothing is listening yet (assigned port ${port}). Not opening the ` +
        `browser — tail the logs (${logFile}) and re-run \`bertrand open\` ` +
        `once the server is up. If the app never binds, its dev command may ` +
        `not honor $PORT: commit a run override that uses $BERTRAND_PORT.`,
    );
  }

  console.log(" ready.");
  if (final.observedPort !== final.port) {
    console.log(
      `Note: the app bound :${final.observedPort} instead of the assigned ` +
        `:${final.port}. Opening the real port; commit a run override that ` +
        `passes $BERTRAND_PORT to pin it.`,
    );
  }
  console.log(`Preview: ${final.url}`);
  openInBrowser(final.url!);
});
