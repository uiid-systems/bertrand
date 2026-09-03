import { register } from "@/cli/router";
import { ensureHooksCurrent } from "@/hooks/install";
import { parseSessionName } from "@/lib/parse-session-name";
import { recoverStaleSessions } from "@/lib/session-recovery";

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

/**
 * `bertrand launch` is the one command that needs the launcher — the PTY
 * engine (`src/engine`) and the Storm TUI (`src/tui`). Both are demoted to
 * optional convenience (ELKY-176): bertrand records a session entirely
 * through its hooks, so nothing on the recording path may pull them in.
 *
 * Hence `await import` rather than a top-level import. `src/index.ts`'s
 * cold-path branch imports this module for *every* non-hook command, so a
 * static import here loaded the PTY relay, the terminal relay client and the
 * TUI's process orchestration — nine modules — into `bertrand list`,
 * `bertrand log`, and every other command that launches nothing.
 * `src/layer-boundary.test.ts` fails if that comes back.
 */
register("launch", async (args) => {
  try {
    // Refresh hook scripts/settings if this binary was upgraded since install
    ensureHooksCurrent();

    // Recover any sessions stuck in working/blocked/prompting from crashed processes
    await recoverStaleSessions();

    const sessionName = args[0];

    if (sessionName) {
      // Direct create+launch: `bertrand my-session`. The user typed the name,
      // so nameSource stays 'manual' (createSession's default).
      const { slug } = parseSessionName(sessionName);
      const { launch } = await import("@/engine/session");
      await launch({ slug });
      return;
    }

    // Default: launch Storm TUI (handles full session loop)
    const { startTui } = await import("@/tui/app");
    await startTui();
  } catch (err) {
    reportFatal(err);
  }
});
