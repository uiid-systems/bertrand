import { register } from "../router.ts";
import { startTui } from "../../tui/app.tsx";

register("launch", async (args) => {
  const sessionName = args[0];

  if (sessionName) {
    // Direct resume: `bertrand my-session`
    console.log(`Resuming session: ${sessionName}`);
    // TODO: look up session by name, launch Claude
    return;
  }

  // Default: launch Storm TUI
  await startTui();
});
