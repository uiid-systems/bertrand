import { register } from "../router.ts";
import { startTui } from "../../tui/app.tsx";
import { parseSessionName } from "../../lib/parse-session-name.ts";
import { launch } from "../../engine/session.ts";

register("launch", async (args) => {
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
