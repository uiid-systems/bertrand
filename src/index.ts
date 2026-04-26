import { route } from "./cli/router";

// Detect command from argv before loading any command modules.
// Hot-path commands (called by hooks during Claude sessions) load only their
// own dependencies (~122 modules / 134KB) instead of the full set
// (~478 modules / 1.9MB) which includes the TUI framework.
const command = process.argv[2];

const hotPath: Record<string, () => Promise<unknown>> = {
  update: () => import("./cli/commands/update"),
  snapshot: () => import("./cli/commands/snapshot"),
  badge: () => import("./cli/commands/badge"),
  notify: () => import("./cli/commands/notify"),
  serve: () => import("./cli/commands/serve"),
};

if (command && command in hotPath) {
  await hotPath[command]!();
} else {
  await Promise.all([
    import("./cli/commands/launch"),
    import("./cli/commands/init"),
    import("./cli/commands/list"),
    import("./cli/commands/log"),
    import("./cli/commands/stats"),
    import("./cli/commands/archive"),
    import("./cli/commands/update"),
    import("./cli/commands/snapshot"),
    import("./cli/commands/serve"),
    import("./cli/commands/mcp"),
    import("./cli/commands/import"),
    import("./cli/commands/completion"),
    import("./cli/commands/badge"),
    import("./cli/commands/notify"),
  ]);
}

await route(process.argv);
process.exit(0);
