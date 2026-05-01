import { register } from "@/cli/router";
import { getTerminalAdapter } from "@/terminal/index";

// Usage: bertrand notify <title> <body>
register("notify", async (args) => {
  const adapter = getTerminalAdapter();
  const title = args[0] ?? "bertrand";
  const body = args.slice(1).join(" ");
  if (body) {
    adapter.notify(title, body);
  }
});
