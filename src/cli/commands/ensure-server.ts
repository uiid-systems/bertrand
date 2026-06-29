import { register } from "@/cli/router";
import { ensureServerForActiveSessions } from "@/lib/server-lifecycle";

// Recovery command: spawn a detached `bertrand serve` only if a session still
// needs the dashboard, otherwise a no-op. Invoked by the dashboard dev script
// on exit (handing the port back to bertrand) and by the UserPromptSubmit hook
// (so a server that went away mid-session is back by the next turn). Hot-path:
// loads minimal deps and skips the migration check via HOOK_COMMANDS.
register("ensure-server", async () => {
  await ensureServerForActiveSessions();
});
