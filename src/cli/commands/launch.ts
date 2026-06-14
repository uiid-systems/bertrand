import { register } from "@/cli/router";
import { startTui, runSessionLoop } from "@/tui/app";
import { parseSessionName } from "@/lib/parse-session-name";
import { launch } from "@/engine/session";
import { recoverStaleSessions } from "@/engine/recovery";

register("launch", async (args) => {
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
});
