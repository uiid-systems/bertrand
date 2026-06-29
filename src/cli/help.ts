/**
 * Top-level `bertrand --help` text.
 *
 * Single source of truth for the command reference: `bertrand --help` prints it,
 * and the session-start contract injects the `{ agent: true }` variant so the
 * agent discovers what the CLI can do (see engine/session.ts, cli/commands/contract.ts).
 * Subcommand-level help (`bertrand project --help`, `bertrand sync --help`) lives
 * with each command and is intentionally not duplicated here.
 *
 * The command reference body is shared. Only the header differs by audience:
 * a human running `--help` at a shell prompt is NOT inside a session, so the
 * agent framing ("you are running inside a session…") would be inaccurate for
 * them — hence the conditional.
 */

const COMMAND_REFERENCE = `Usage:
  bertrand                     Launch the interactive TUI; start or resume a session.
  bertrand init                First-time setup: install hooks, settings, completions.

Inspect sessions (read-only):
  bertrand list [--json]       List sessions in the active project with status + activity.
  bertrand log <session> [--json]
                               Full record for one session: metadata, stats,
                               conversations, and the complete event timeline.
                               <session> is "<category>/<slug>" (see \`list\`). Use this
                               to see what was decided or tried in another session.
  bertrand stats <session> [--json]
                               Aggregate statistics (durations, interactions, diff metrics).

Manage sessions & projects:
  bertrand archive <session>   Archive or unarchive a session.
  bertrand project <op>        list | create | switch | current | rename | remove | import
                               (bertrand project --help)
  bertrand sync <op>           onboard | push | pull | status | invite | enable | disable
                               (bertrand sync --help)
  bertrand serve               Start the local dashboard HTTP server.

Add --json to list/log/stats for machine-readable output. Most commands accept
--project <slug> to target a project other than the active one.`;

const HUMAN_HEADER = `bertrand — multi-session workflow manager for Claude Code

bertrand wraps each Claude Code conversation in a tracked "session": it records the
full event timeline (prompts, answers, tool use, PRs, deploys), groups sessions by
project, and can replicate that history across machines.`;

const AGENT_HEADER = `## bertrand CLI

You are running inside a bertrand session. bertrand wraps each Claude Code
conversation in a tracked "session" and records the full event timeline (prompts,
answers, tool use, PRs, deploys), grouped by project and replicable across machines.
The subcommands below inspect and manage that data — reach for them (e.g.
\`bertrand log <session>\`) instead of assuming sessions are isolated.`;

/**
 * Render the top-level help.
 * @param opts.agent  Use the session-context header instead of the human one.
 *                    This is the variant injected into the session-start contract.
 */
export function helpText(opts: { agent?: boolean } = {}): string {
  const header = opts.agent ? AGENT_HEADER : HUMAN_HEADER;
  return `${header}\n\n${COMMAND_REFERENCE}`;
}
