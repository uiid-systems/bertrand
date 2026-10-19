import { register } from "@/cli/router";
import { recoverStaleSessions } from "@/lib/session-recovery";

/**
 * Finalize sessions whose Claude process is gone (see lib/session-recovery.ts).
 *
 * `bertrand launch` sweeps on its own; this is the sweep for everyone else. An
 * adopted session has no bertrand process watching it exit, so a user who only
 * ever records through `/bertrand`, `adopt` or auto-adoption would otherwise
 * collect sessions marked live forever. The UserPromptSubmit hook runs this in
 * the background, throttled by a marker in the runtime dir, so it costs a
 * prompt nothing.
 */
register("recover", async () => {
  await recoverStaleSessions();
});
