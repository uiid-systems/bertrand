import { existsSync } from "fs";
import { paths } from "@/lib/paths";
import { triggerBackgroundPull } from "@/sync/trigger";

type CommandHandler = (args: string[]) => void | Promise<void>;

const commands = new Map<string, CommandHandler>();
const aliases = new Map<string, string>();

export function register(name: string, handler: CommandHandler) {
  commands.set(name, handler);
}

export function alias(from: string, to: string) {
  aliases.set(from, to);
}

/**
 * Run init silently before falling through to launch on a fresh install.
 *
 * Detected by the absence of the SQLite db file. Init's success logs are
 * suppressed so the first-run experience is just one line + the TUI;
 * errors stay visible. Failures abort with init's own exit code.
 */
async function autoInitIfFirstRun() {
  if (existsSync(paths.db)) return;

  const init = commands.get("init");
  if (!init) return; // hot-path entrypoints don't load init; skip silently

  console.log("Setting up bertrand for first use…");
  const origLog = console.log;
  console.log = () => {};
  try {
    await init([]);
  } finally {
    console.log = origLog;
  }
}

export async function route(argv: string[]) {
  // argv: ["bun", "src/index.ts", ...args]
  const args = argv.slice(2);
  const command = args[0];

  // No args → launch TUI (auto-init on fresh install first)
  if (!command) {
    await autoInitIfFirstRun();
    // Kick a pull in the background so the picker reflects work done on
    // other machines. Silent on failure; the user can still launch offline.
    triggerBackgroundPull();
    const handler = commands.get("launch");
    if (!handler) throw new Error("No launch command registered");
    return handler(args);
  }

  // Unknown command → error
  if (!resolveCommand(command)) {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }

  const resolved = resolveCommand(command)!;
  const handler = commands.get(resolved)!;
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
  bertrand sync <op>        push|pull|status|onboard (see: bertrand sync --help)
`.trim());
}
