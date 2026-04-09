import { register } from "../router.ts";

register("log", async (args) => {
  const session = args[0];
  if (!session) {
    console.error("Usage: bertrand log <session>");
    process.exit(1);
  }
  console.log(`TODO: View log for ${session}`);
});
