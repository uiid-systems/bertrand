import { existsSync } from "fs";
import { resolveActiveProject } from "@/lib/projects/resolve";
import { migrateLegacyLayout } from "@/lib/projects/migrate-layout";
import { DEFAULT_PROJECT_SLUG } from "@/lib/projects/registry";
import { triggerBackgroundPull } from "@/sync/trigger";
import { helpText } from "@/cli/help";

type CommandHandler = (args: string[]) => void | Promise<void>;

const commands = new Map<string, CommandHandler>();
const aliases = new Map<string, string>();

/**
 * Commands fired by Claude Code hooks during a live session. They run
 * inside an existing bertrand process tree — their parent already
 * migrated on its own launch — so we skip the migration check entirely
 * to avoid log noise on every hook fire in the rare upgrade-mid-session
 * case (parent on an old binary, hook running a new binary).
 *
 * Keep in sync with the registered command names in `src/cli/commands/`.
 */
const HOOK_COMMANDS = new Set([
  "update",
  "ingest-transcript",
  "contract",
  "ensure-server",
]);

export function register(name: string, handler: CommandHandler) {
  commands.set(name, handler);
}

export function alias(from: string, to: string) {
  aliases.set(from, to);
}

/**
 * One-shot legacy → per-project layout migration. Runs before every command
 * so an upgrade from a pre-project bertrand picks up the move on first
 * launch. The function is fast and idempotent on the no-op path.
 *
 * If the migration refuses because the legacy DB is held by another
 * process, we abort with a clear error rather than silently leaving the
 * user in a broken state (the next `getDb()` would open a fresh empty DB
 * at the new location while their data sits stranded at the old one).
 */
function migrateOrAbort(): void {
  const result = migrateLegacyLayout();
  if (result.migrated) {
    const fileList = result.moved.join(", ");
    console.log(
      `Migrated to per-project layout (moved: ${fileList}). Active project: ${DEFAULT_PROJECT_SLUG}.`,
    );
    return;
  }
  if (!result.migrated && result.reason === "db-held") {
    const procs = result.holders.map((h) => `${h.command}(${h.pid})`).join(", ");
    console.error(
      `Cannot migrate to per-project layout: legacy database is held by ${procs}.\n` +
        `Close all active bertrand sessions and try again.`,
    );
    process.exit(1);
  }
}

/**
 * Run init silently before falling through to launch on a fresh install.
 *
 * Detected by the absence of the SQLite db file. Init's success logs are
 * suppressed so the first-run experience is just one line + the TUI;
 * errors stay visible. Failures abort with init's own exit code.
 */
async function autoInitIfFirstRun() {
  if (existsSync(resolveActiveProject().db)) return;

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

  // Top-level help. Matched in command position only so subcommand helps
  // (`bertrand project --help`) still reach their own handlers. Side-effect
  // free: returns before the migration check so `--help` never touches the DB.
  // `--agent` prints the session-context variant injected at session start.
  if (command === "--help" || command === "-h" || command === "help") {
    console.log(helpText({ agent: args.includes("--agent") }));
    return;
  }

  // Migrate legacy single-DB layout to per-project before any command can
  // touch `getDb()`. Idempotent and fast on the no-op path.
  //
  // Hook-fired commands skip this — their parent process (the bertrand
  // TUI / `bertrand launch`) already ran the migration, and avoiding the
  // call here means an upgrade-mid-session doesn't print "db-held" errors
  // on every hook fire (which would happen if a still-running old-binary
  // session held the legacy DB while the new-binary hook tried to migrate).
  if (!command || !HOOK_COMMANDS.has(command)) {
    migrateOrAbort();
  }

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
  console.log(helpText());
}
