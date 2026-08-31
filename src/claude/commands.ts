/**
 * The `/bertrand` slash command (ELKY-179 Task 4).
 *
 * `bertrand adopt` gives a claude that bertrand didn't launch a session, and
 * the hook guards resolve it from the adoption marker — but only a user who
 * already knows the CLI would ever run it. The slash command is the discoverable
 * front door: type `/bertrand` inside any claude and it starts being recorded.
 *
 * Distribution mirrors the hooks. `bertrand init` writes the file, and
 * `ensureHooksCurrent` rewrites it when it drifts from what the running binary
 * would produce, so a version upgrade refreshes the command without the user
 * re-running init.
 *
 * The one difference from the hooks directory: `~/.claude/commands/` belongs to
 * the *user*, not to bertrand. `~/.bertrand/hooks/` can be swept wholesale
 * because nothing else writes there; here, orphan cleanup is restricted to
 * files carrying {@link MANAGED_MARKER}. A user's own `deploy.md` sitting
 * beside ours must survive every install.
 */

import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { paths } from "@/lib/paths";

/**
 * Ownership stamp. Present in every command file bertrand writes, and the only
 * thing that licenses deleting one. It rides in the prompt body rather than the
 * frontmatter because unknown frontmatter keys are Claude Code's to interpret,
 * while an HTML comment is inert everywhere.
 */
export const MANAGED_MARKER = "<!-- bertrand:managed -->";

/**
 * The command body.
 *
 * Two things here are load-bearing and easy to "simplify" back into bugs:
 *
 * 1. **It prints the contract itself.** The obvious design lets the
 *    UserPromptSubmit hook deliver the contract on the next turn. But that hook
 *    fires only on a real prompt submission, and an AskUserQuestion answer is a
 *    tool result, not a prompt — so a session that ends every turn on AUQ (which
 *    is precisely what the contract asks for) can go indefinitely without ever
 *    submitting another prompt. The contract would arrive last in the sessions
 *    that need it first. Running `contract --mark-sent` here delivers it inside
 *    the activating turn and tells the hook to degrade to its one-line reminder
 *    from then on.
 *
 * 2. **Neither command takes arguments.** `adopt` and `contract` both default to
 *    `$CLAUDE_CODE_SESSION_ID` / `$CLAUDE_PID` out of their own environment, so
 *    there is no session id for the model to discover, copy, or get wrong. Every
 *    id that appears in this file would be one more thing to thread by hand.
 */
function bertrandCommand(bin: string): string {
  return `---
description: Record this Claude session in bertrand
argument-hint: [what you want to work on]
allowed-tools: Bash(${bin} adopt:*), Bash(${bin} contract:*)
---

${MANAGED_MARKER}

Attach this Claude session to bertrand before doing anything else. Run both
commands exactly as written — they read this session's id and pid from their own
environment, so neither takes arguments and there is nothing to fill in.

1. Run \`${bin} adopt\`. Expect one of:
   - \`Adopted this claude session as <slug>.\` — bertrand is recording now.
   - \`This conversation is already recorded as …\` or \`This claude was launched
     by bertrand …\` — it was already being recorded. Nothing is wrong; carry on
     to step 2.

   Anything else — a non-zero exit, \`command not found\`, an error — means this
   session is **not** being recorded. Report the output verbatim, tell the user
   nothing was attached, and stop.

2. Run \`${bin} contract --mark-sent\`. It prints the session contract. Read it
   and follow it for the rest of this session; it governs how every turn ends,
   including this one.

3. Tell the user in one line which session is recording them. Don't recite the
   contract back — they wrote it.

4. Then continue as the contract instructs. If there's a request below, start on
   it in this same turn: attaching the session is setup, not the work.

$ARGUMENTS
`;
}

/** Command files bertrand owns, by filename under `~/.claude/commands/`. */
export const CLAUDE_COMMANDS: Record<string, (bin: string) => string> = {
  // Top-level, not nested in a `bertrand/` subdirectory: Claude Code namespaces
  // commands by directory, so `commands/bertrand/start.md` would be
  // `/bertrand:start`. The command is `/bertrand`, so the file is `bertrand.md`.
  "bertrand.md": bertrandCommand,
};

export interface CommandInstallOptions {
  quiet?: boolean;
  /** Test override for ~/.claude/commands. */
  dir?: string;
}

/**
 * Write bertrand's slash commands into `~/.claude/commands/`.
 *
 * Write-then-rename for the same reason the hook scripts use it: Claude Code
 * may be reading the file at the moment a reinstall lands, and a rename swaps
 * the inode instead of truncating under the reader.
 */
export function installClaudeCommands(
  bin: string,
  opts: CommandInstallOptions = {},
): void {
  const dir = opts.dir ?? paths.claudeCommands;
  mkdirSync(dir, { recursive: true });

  for (const [filename, render] of Object.entries(CLAUDE_COMMANDS)) {
    const filePath = join(dir, filename);
    const tmpPath = `${filePath}.tmp-${process.pid}`;
    writeFileSync(tmpPath, render(bin));
    renameSync(tmpPath, filePath);
  }

  for (const orphan of orphanCommands(dir)) {
    unlinkSync(join(dir, orphan));
    if (!opts.quiet) console.log(`  Removed retired command: /${orphan.replace(/\.md$/, "")}`);
  }

  if (!opts.quiet) {
    console.log(
      `Installed ${Object.keys(CLAUDE_COMMANDS).length} Claude command to ${dir}`,
    );
  }
}

/**
 * Command files bertrand wrote in a previous version and no longer ships.
 *
 * Ownership is proven per file, never assumed from the directory — see the
 * module doc. A file we can't read, or one without the marker, is somebody
 * else's and is left strictly alone.
 */
function orphanCommands(dir: string): string[] {
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  return files.filter((f) => {
    if (!f.endsWith(".md") || f in CLAUDE_COMMANDS) return false;
    try {
      return readFileSync(join(dir, f), "utf-8").includes(MANAGED_MARKER);
    } catch {
      return false;
    }
  });
}

/** True when every installed command file matches what this binary would write. */
export function claudeCommandsAreCurrent(
  bin: string,
  opts: CommandInstallOptions = {},
): boolean {
  const dir = opts.dir ?? paths.claudeCommands;
  for (const [filename, render] of Object.entries(CLAUDE_COMMANDS)) {
    let installed: string;
    try {
      installed = readFileSync(join(dir, filename), "utf-8");
    } catch {
      return false;
    }
    if (installed !== render(bin)) return false;
  }
  return orphanCommands(dir).length === 0;
}
