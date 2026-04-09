import { register } from "../router.ts";

register("archive", async (args) => {
  const session = args[0];
  if (!session) {
    console.error("Usage: bertrand archive <session>");
    process.exit(1);
  }
  console.log(`TODO: Archive ${session}`);
});
