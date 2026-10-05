/**
 * Top-level `bertrand --help` text.
 *
 * Single source of truth for the command reference: `bertrand --help` prints it,
 * and the session-start contract injects the `{ agent: true }` variant so the
 * agent discovers what the CLI can do (see engine/session.ts, cli/commands/contract.ts).
 * Subcommand-level help (`bertrand adopt --help`, `bertrand sync --help`) lives
 * with each command and is intentionally not duplicated here.
 *
 * The two audiences get different bodies. A human gets the whole reference. The
 * agent gets only the read-only inspection commands, compacted: it is paid for
 * in tokens on every conversation, and the management commands (init, archive,
 * rename, adopt, sync, serve) are the human's to run — `bertrand --help` is one
 * call away when an agent needs them (docs/context-budget.md). help.test.ts
 * guards the subset against drifting from the full reference.
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

const AGENT_REFERENCE = `## bertrand CLI

You are running inside a bertrand session. Every conversation's prompts,
answers, tool use and outcome are recorded, grouped by repo and branch. Reach
for past sessions instead of assuming sessions are isolated — as history (why,
what was tried); code and git are the current truth.

  bertrand log <session>       Digest (JSON, ~1-2KB per conversation): subject,
                               Q&A decisions, files touched, outcome. Start here.
    --events                   Filtered timeline when the digest isn't enough:
                               --conversation <n> --type <…> --since <…> --limit <n>
  bertrand search <term…>      Where something was discussed across sessions.
                               Terms AND-ed; returns pointers to drill into.
  bertrand list [--json]       Every session with its repo, status + activity.
  bertrand stats <session>     Durations, interactions, diff metrics.

Everything else (and every flag): \`bertrand --help\`.`;

/**
 * Render the top-level help.
 * @param opts.agent  The compact session-context variant injected into the
 *                    session-start contract, instead of the full human help.
 */
export function helpText(opts: { agent?: boolean } = {}): string {
  return opts.agent ? AGENT_REFERENCE : `${HUMAN_HEADER}\n\n${COMMAND_REFERENCE}`;
}
