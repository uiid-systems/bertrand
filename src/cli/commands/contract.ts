import { register } from "@/cli/router";
import { getSession } from "@/db/queries/sessions";
import { buildContract } from "@/contract/template";
import { buildSiblingContext } from "@/contract/context";
import { helpText } from "@/cli/help";
import { markContractSent, readAdoptionMarker } from "@/hooks/runtime";
import { useProject } from "@/lib/projects/cli-flag";

/**
 * Print the session contract to stdout. Hook-facing.
 *
 * The contract is normally delivered once via `--append-system-prompt` on
 * bertrand's own `spawn("claude", …)` (see engine/process.ts). That's an argv
 * channel — it reaches exactly one process. Any Claude that runs inside the
 * bertrand environment but was *not* spawned by launchClaude (background jobs,
 * nested `claude` invocations, an external launcher) inherits the
 * BERTRAND_* env vars — so every hook fires and treats it as a real session —
 * but never receives the contract argv.
 *
 * This command lets the UserPromptSubmit hook re-deliver the contract through
 * the durable env/hook channel, so the guidance reaches those sessions too.
 * It mirrors exactly what engine/session.ts builds at launch.
 *
 * `--short` emits a one-line reminder instead of the full contract, for turns
 * after the first where the full text is already in context.
 *
 * `--mark-sent` writes the once-per-conversation marker the hook otherwise
 * writes for itself. The `/bertrand` command needs it: it delivers the full
 * contract inside the activating turn, and without the marker the next
 * UserPromptSubmit would deliver the whole thing a second time.
 */

/** Which session's contract to print, and where its row lives. */
export interface ContractTarget {
  sessionId: string;
  /** Conversation the contract-sent marker is keyed by. */
  conversationId: string;
  /**
   * Project holding the session row, when resolution had to name one. Only the
   * adoption marker does: an adopted claude never inherited BERTRAND_PROJECT,
   * so without this the lookup would run against whichever project happens to
   * be active and find nothing.
   */
  project?: string;
}

type Env = Record<string, string | undefined>;

/**
 * Resolve the session to print for, in descending order of directness:
 *
 *   1. `--session-id` — what the hooks pass, always.
 *   2. `BERTRAND_SESSION` — a claude bertrand launched, invoked by hand.
 *   3. The adoption marker for `CLAUDE_CODE_SESSION_ID` — a claude bertrand
 *      adopted, which has no bertrand env at all because adoption cannot
 *      inject any into a process that is already running.
 *
 * (3) is what makes the bare `bertrand contract` work from inside an adopted
 * session, so the slash command has no id to thread from `adopt` to here.
 */
export function resolveContractTarget(
  args: string[],
  env: Env = process.env,
): ContractTarget | null {
  const explicit = flag(args, "session-id");
  const claudeId = env.BERTRAND_CLAUDE_ID || env.CLAUDE_CODE_SESSION_ID || "";

  const known = explicit || env.BERTRAND_SESSION;
  if (known) {
    // Mirrors the hook's `${cid:-$sid}`: a session with no conversation of its
    // own keys the marker by session id.
    return { sessionId: known, conversationId: claudeId || known };
  }

  if (!claudeId) return null;
  const adopted = readAdoptionMarker(claudeId);
  if (!adopted) return null;
  return {
    sessionId: adopted.sessionId,
    conversationId: claudeId,
    project: adopted.project,
  };
}

/** `--name value` or `--name=value`, whichever form the caller used. */
function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  if (index !== -1) return args[index + 1];
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  return inline?.slice(name.length + 3);
}

register("contract", async (args) => {
  const short = args.includes("--short");
  const markSent = args.includes("--mark-sent");

  const target = resolveContractTarget(args);
  if (!target) {
    console.error(
      "Not a bertrand session: no --session-id, no BERTRAND_SESSION, and no " +
        "adoption marker for this claude. Run `bertrand adopt` (or /bertrand) first.",
    );
    process.exit(1);
  }

  if (target.project) useProject(target.project);

  const session = getSession(target.sessionId);
  if (!session) return; // unknown session → emit nothing, hook injects no context

  const sessionName = session.slug;

  if (short) {
    process.stdout.write(
      `Reminder — you are in bertrand session ${sessionName}: end this turn with an AskUserQuestion call (multiSelect:true on every question, plus a "Done for now" option).`,
    );
    return;
  }

  const siblingContext = buildSiblingContext(session.id);
  process.stdout.write(
    buildContract(sessionName, helpText({ agent: true }), siblingContext),
  );

  // After the write, not before: a marker set by a run that then failed to
  // print would downgrade every later delivery to the reminder, and the full
  // contract would never reach the session at all.
  if (markSent) markContractSent(target.conversationId);
});
