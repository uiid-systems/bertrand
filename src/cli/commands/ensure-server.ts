import { register } from "@/cli/router";
import { ensureServerStarted } from "@/lib/server-lifecycle";

// Spawn a detached `bertrand serve` unless one is already up. Invoked by the
// UserPromptSubmit hook, so every launch path converges here: the TUI, a
// `/bertrand`-adopted session, an Orca session, a bare `claude`. Whichever
// gets a prompt first brings the server up; nothing ever takes it down.
//
// Hot-path: loads minimal deps and skips the migration check via HOOK_COMMANDS.
// A healthy server costs one `kill(pid, 0)` here.
register("ensure-server", async () => {
  await ensureServerStarted({ waitForReady: false });
});
