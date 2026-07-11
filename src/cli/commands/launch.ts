import { register } from "@/cli/router";
import { startTui, runSessionLoop } from "@/tui/app";
import { ensureHooksCurrent } from "@/hooks/install";
import { parseSessionName } from "@/lib/parse-session-name";
import { launch } from "@/engine/session";
import { recoverStaleSessions } from "@/engine/recovery";

/**
 * Print a clean one-line error and exit non-zero. Stack stays available
 * under BERTRAND_DEBUG for diagnosing real bugs without making the
 * end-user-facing failure look like a crash.
 */
function reportFatal(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`bertrand: ${message}`);
  if (process.env.BERTRAND_DEBUG && err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
}

register("launch", async (args) => {
  try {
    // Refresh hook scripts/settings if this binary was upgraded since install
    ensureHooksCurrent();

    // Recover any sessions stuck in working/blocked/prompting from crashed processes
    recoverStaleSessions();

    const sessionName = args[0];

    if (sessionName) {
      // Direct create+launch: `bertrand category/my-session`
      const { categoryPath, slug } = parseSessionName(sessionName);
      const sessionId = await launch({ categoryPath, slug });
      await runSessionLoop(sessionId);
      return;
    }

    // Default: launch Storm TUI (handles full session loop)
    await startTui();
  } catch (err) {
    reportFatal(err);
  }
});
