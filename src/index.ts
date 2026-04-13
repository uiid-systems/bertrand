// Register all commands (side-effect imports)
import "./cli/commands/launch";
import "./cli/commands/init";
import "./cli/commands/list";
import "./cli/commands/log";
import "./cli/commands/stats";
import "./cli/commands/archive";
import "./cli/commands/update";
import "./cli/commands/serve";
import "./cli/commands/mcp";
import "./cli/commands/import";
import "./cli/commands/completion";
import "./cli/commands/badge";
import "./cli/commands/notify";

import { route } from "./cli/router";

await route(process.argv);
process.exit(0);
