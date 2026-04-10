import { register } from "../router.ts";
import { startTui } from "../../tui/app.tsx";
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
    await launch({ groupPath, slug });
    return;
  }

  // Default: launch Storm TUI
  await startTui();
});
