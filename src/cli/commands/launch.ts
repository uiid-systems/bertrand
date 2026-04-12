import { register } from "../router.ts";
import { startTui, runSessionLoop } from "../../tui/app.tsx";
import { parseSessionName } from "../../lib/parse-session-name.ts";
import { launch } from "../../engine/session.ts";
import { recoverStaleSessions } from "../../engine/recovery.ts";

register("launch", async (args) => {
  // Recover any sessions stuck in working/blocked/prompting from crashed processes
  recoverStaleSessions();

  const sessionName = args[0];

  if (sessionName) {
    // Direct create+launch: `bertrand project/my-session`
    const { groupPath, slug } = parseSessionName(sessionName);
    const sessionId = await launch({ groupPath, slug });
    await runSessionLoop(sessionId);
    return;
  }

  // Default: launch Storm TUI (handles full session loop)
  await startTui();
});
