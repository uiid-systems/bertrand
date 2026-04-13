// Register all commands (side-effect imports)
import "./cli/commands/launch.ts";
import "./cli/commands/init.ts";
import "./cli/commands/list.ts";
import "./cli/commands/log.ts";
import "./cli/commands/stats.ts";
import "./cli/commands/archive.ts";
import "./cli/commands/update.ts";
import "./cli/commands/serve.ts";
import "./cli/commands/mcp.ts";
import "./cli/commands/import.ts";
import "./cli/commands/completion.ts";
import "./cli/commands/badge.ts";
import "./cli/commands/notify.ts";

import { route } from "./cli/router";

await route(process.argv);
process.exit(0);
