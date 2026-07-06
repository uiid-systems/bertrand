import { route } from "./cli/router";

// Detect command from argv before loading any command modules.
// Hot-path commands (called by hooks during Claude sessions) load only their
// own dependencies (~122 modules / 134KB) instead of the full set
// (~478 modules / 1.9MB) which includes the TUI framework.
const command = process.argv[2];

const hotPath: Record<string, () => Promise<unknown>> = {
  update: () => import("./cli/commands/update"),
  "ingest-transcript": () => import("./cli/commands/ingest-transcript"),
  contract: () => import("./cli/commands/contract"),
  serve: () => import("./cli/commands/serve"),
  "ensure-server": () => import("./cli/commands/ensure-server"),
  sync: () => import("./cli/commands/sync"),
};

if (command && command in hotPath) {
  await hotPath[command]!();
} else {
  await Promise.all([
    import("./cli/commands/launch"),
    import("./cli/commands/init"),
    import("./cli/commands/list"),
    import("./cli/commands/log"),
    import("./cli/commands/search"),
    import("./cli/commands/stats"),
    import("./cli/commands/backfill-stats"),
    import("./cli/commands/archive"),
    import("./cli/commands/open"),
    import("./cli/commands/update"),
    import("./cli/commands/ingest-transcript"),
    import("./cli/commands/contract"),
    import("./cli/commands/serve"),
    import("./cli/commands/sync"),
    import("./cli/commands/project"),
  ]);
}

await route(process.argv);
process.exit(0);
