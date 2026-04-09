import { register } from "../router.ts";

register("stats", async (args) => {
  const session = args[0];
  if (!session) {
    console.error("Usage: bertrand stats <session>");
    process.exit(1);
  }
  console.log(`TODO: Stats for ${session}`);
});
