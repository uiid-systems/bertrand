import { register } from "../router.ts";
import { getTerminalAdapter } from "../../terminal/index.ts";

// Usage: bertrand badge <icon> --color <color> [--priority <n>] [--beep] [--clear]
register("badge", async (args) => {
  const adapter = getTerminalAdapter();

  if (args.includes("--clear")) {
    adapter.clearBadge();
    return;
  }

  const icon = args[0];
  if (!icon) return;

  const colorIdx = args.indexOf("--color");
  const color = colorIdx >= 0 ? args[colorIdx + 1] ?? "#ffffff" : "#ffffff";

  const priorityIdx = args.indexOf("--priority");
  const priority = priorityIdx >= 0 ? parseInt(args[priorityIdx + 1] ?? "10") : 10;

  const beep = args.includes("--beep");

  adapter.badge(icon, color, priority, beep);
});
