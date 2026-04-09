type CommandHandler = (args: string[]) => void | Promise<void>;

const commands = new Map<string, CommandHandler>();
const aliases = new Map<string, string>();

export function register(name: string, handler: CommandHandler) {
  commands.set(name, handler);
}

export function alias(from: string, to: string) {
  aliases.set(from, to);
}

export async function route(argv: string[]) {
  // argv: ["bun", "src/index.ts", ...args]
  const args = argv.slice(2);
  const command = args[0];

  // No args or first arg doesn't match a command → launch (default)
  if (!command || !resolveCommand(command)) {
    const handler = commands.get("launch");
    if (!handler) throw new Error("No launch command registered");
    return handler(args);
  }

  const resolved = resolveCommand(command)!;
  const handler = commands.get(resolved);
  if (!handler) {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }

  return handler(args.slice(1));
}

function resolveCommand(name: string): string | undefined {
  if (commands.has(name)) return name;
  const aliased = aliases.get(name);
  if (aliased && commands.has(aliased)) return aliased;
  return undefined;
}

function printUsage() {
  console.log(`
bertrand — multi-session workflow manager for Claude Code

Usage:
  bertrand                  Launch TUI (or resume named session)
  bertrand init             Setup wizard
  bertrand list             Session picker
  bertrand log <session>    View session log
  bertrand stats <session>  Session statistics
  bertrand archive <name>   Archive/unarchive a session
  bertrand update           Hook-facing state writer (internal)
  bertrand serve            Start dashboard HTTP server
  bertrand mcp              Start MCP server (stdio)
  bertrand import           Import sessions from Go format
  bertrand completion       Shell completions
`.trim());
}
