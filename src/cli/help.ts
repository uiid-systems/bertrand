/**
 * Top-level `bertrand --help` text.
 *
 * Single source of truth for the command reference: `bertrand --help` prints it,
 * and the session-start contract injects the `{ agent: true }` variant so the
 * agent discovers what the CLI can do (see engine/session.ts, cli/commands/contract.ts).
 * Subcommand-level help (`bertrand adopt --help`, `bertrand sync --help`) lives
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
  bertrand list [--json]       List every session with its repo, status + activity.
  bertrand log <session>       Session digest (JSON): per-conversation subject, Q&A
                               decision trail, files touched, and outcome. Start here —
                               ~1-2KB per conversation covers what was decided and tried.
                               <session> is the session slug (see \`list\`); old
                               "<category>/<slug>" names still resolve.
  bertrand log <session> --events
                               Filtered event timeline when the digest isn't enough.
                               Flags: --conversation <n> --limit <n> --since <ISO|24h|30m>
                               --type qa,prompt,assistant,tool,lifecycle (or event names)
  bertrand log <session> --full
                               Complete record with raw event meta (100KB+). For
                               debugging — too large to load into context.
  bertrand search <term…>      Find where something was discussed or decided across
                               sessions. Terms AND-ed, case-insensitive. Returns
                               pointers (session, conversation, snippet) — drill in
                               with \`log <session> --events --conversation <n>\`.
                               Flags: --type prompt,question,answer,assistant,summary,tool
                               --session <name> --limit <n>
  bertrand stats <session> [--json]
                               Aggregate statistics (durations, interactions, diff metrics).

Manage sessions:
  bertrand archive <session>   Archive or unarchive a session.
  bertrand rename <session> <new-slug>
                               Rename a session; its old name keeps resolving.
  bertrand adopt               Record the claude session running in this terminal
                               as a bertrand session, back-filling the conversation
                               so far. For claudes bertrand didn't launch (an ADE,
                               or \`claude\` by hand). (bertrand adopt --help)
                               Set \`{ "autoAdopt": true }\` in ~/.bertrand/config.json
                               to do this automatically, from a conversation's
                               second prompt on — no \`adopt\` needed.
  bertrand sync <op>           onboard | push | pull | status | invite | enable | disable
                               (bertrand sync --help)
  bertrand serve               Start the local dashboard HTTP server.

\`log\` always emits JSON; add --json to list/stats for the same.

Sessions are grouped by the repo and branch they run in, derived from the
session's directory — there is nothing to register and nothing to switch
between.`;

const HUMAN_HEADER = `bertrand — multi-session workflow manager for Claude Code

bertrand wraps each Claude Code conversation in a tracked "session": it records the
full event timeline (prompts, answers, tool use, PRs, deploys), groups sessions by
the repo and branch they run in, and can replicate that history across machines.`;

const AGENT_HEADER = `## bertrand CLI

You are running inside a bertrand session. bertrand wraps each Claude Code
conversation in a tracked "session" and records the full event timeline (prompts,
answers, tool use, PRs, deploys), grouped by the repo and branch the session runs
in, and replicable across machines.
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
