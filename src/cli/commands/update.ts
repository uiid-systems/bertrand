import { register } from "../router.ts";

register("update", async (args) => {
  // TODO: parse --session-id, --event, --meta flags
  // Write event to SQLite + update session status
  console.log("TODO: Hook-facing state writer");
});
