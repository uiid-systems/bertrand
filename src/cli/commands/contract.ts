import { register } from "@/cli/router";
import { getSession } from "@/db/queries/sessions";
import { getEventsByType } from "@/db/queries/events";
import { buildContract, buildReminder } from "@/contract/template";
import {
  byteLength,
  contractLayers,
  logContextDelivery,
  type ContextLayer,
} from "@/contract/layers";
import { formatRecall, queryText, recall } from "@/contract/recall";
import { isContextRecallEnabled } from "@/lib/config";
import { findClaudeTranscript, readTypedPrompts } from "@/lib/transcript";
import {
  isContractSent,
  markContractSent,
  markRecalled,
  readAdoptionMarker,
  readRecalled,
} from "@/hooks/runtime";

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
 * It mirrors exactly what engine/session.ts builds at launch. A fresh launch
 * marks its conversation as sent (`deliverContract` in engine/process.ts), so
 * the hook's full copy goes only to claudes that never got the argv — and to
 * resumed ones, since claude ignores `--append-system-prompt` on `--resume`.
 *
 * `--short` emits the session rules plus a one-line loop reminder instead of the
 * full contract, for turns after the first where the full text is already in
 * context. See `buildReminder` for why it re-states the rules and not the
 * hook-enforced mechanics.
 *
 * `--mark-sent` writes the once-per-conversation marker the hook otherwise
 * writes for itself. The `/bertrand` command needs it: it delivers the full
 * contract inside the activating turn, and without the marker the next
 * UserPromptSubmit would deliver the whole thing a second time.
 *
 * `--prompt-stdin` hands over the prompt being submitted, for prompt-keyed
 * recall (contract/recall.ts, behind `contextRecall`). Read from stdin, not
 * argv: a prompt can be pasted pages. `--transcript-path` says where the
 * conversation's earlier prompts are, for a full delivery's query. Recall runs here rather than in a hook
 * step of its own so it costs no second bun start on a path the user waits on.
 */

/** Which session's contract to print. */
export interface ContractTarget {
  sessionId: string;
  /** Conversation the contract-sent marker is keyed by. */
  conversationId: string;
}

type Env = Record<string, string | undefined>;

/**
 * Resolve the session to print for, in descending order of directness:
 *
 *   1. `--session-id` — what the hooks pass, always, with `--conversation-id`.
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
  const claudeId =
    flag(args, "conversation-id") || env.BERTRAND_CLAUDE_ID || env.CLAUDE_CODE_SESSION_ID || "";

  const known = explicit || env.BERTRAND_SESSION;
  if (known) {
    // Mirrors the hook's `${cid:-$sid}`: a session with no conversation of its
    // own keys the marker by session id.
    return { sessionId: known, conversationId: claudeId || known };
  }

  if (!claudeId) return null;
  const adopted = readAdoptionMarker(claudeId);
  if (!adopted) return null;
  return { sessionId: adopted.sessionId, conversationId: claudeId };
}

/** `--name value` or `--name=value`, whichever form the caller used. */
function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  if (index !== -1) return args[index + 1];
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  return inline?.slice(name.length + 3);
}

/**
 * Full contract or the short reminder?
 *
 * `--short` always gets the reminder. So does `--mark-sent` once the marker
 * already exists. By the time `/bertrand` runs it, the UserPromptSubmit hook has
 * already handled the `/bertrand` prompt itself, so in a session bertrand
 * launched (or one already attached) the contract arrived through the system
 * prompt or that hook. Printing it again was a third ~9KB copy
 * (docs/context-budget.md). Only a claude the hook skipped — not yet adopted —
 * reaches here unmarked and gets the full text.
 */
export function contractDelivery(
  args: string[],
  conversationId: string,
): "full" | "reminder" {
  if (args.includes("--short")) return "reminder";
  if (args.includes("--mark-sent") && isContractSent(conversationId)) return "reminder";
  return "full";
}

register("contract", async (args) => {
  const target = resolveContractTarget(args);
  if (!target) {
    console.error(
      "Not a bertrand session: no --session-id, no BERTRAND_SESSION, and no " +
        "adoption marker for this claude. Run `bertrand adopt` (or /bertrand) first.",
    );
    process.exit(1);
  }

  const prompt = args.includes("--prompt-stdin") ? await Bun.stdin.text() : "";
  renderContract(args, target, prompt, (text) => process.stdout.write(text));
});

/**
 * Everything `contract` does but read stdin: build what this delivery owes
 * the conversation, `write` it, then record that it went. An unknown session
 * writes nothing, so the hook injects no context.
 */
export function renderContract(
  args: string[],
  target: ContractTarget,
  prompt: string,
  write: (text: string) => void,
): void {
  const session = getSession(target.sessionId);
  if (!session) return;

  const { conversationId } = target;
  const delivery = contractDelivery(args, conversationId);

  const hits = recallFor(session.id, conversationId, delivery, prompt, flag(args, "transcript-path"));
  const recalled: ContextLayer = { name: "recall", text: formatRecall(hits) };

  const layers =
    delivery === "reminder" ? [] : contractLayers(session.id, conversationId);
  const base =
    delivery === "reminder"
      ? buildReminder(session.slug)
      : buildContract(session.slug, ...layers.map((l) => l.text));
  const output = recalled.text ? `${base}\n\n${recalled.text}` : base;
  write(output);

  // After the write, not before: a marker set by a run that then failed to
  // print would downgrade every later delivery to the reminder, and the full
  // contract would never reach the session at all.
  if (args.includes("--mark-sent") && delivery === "full") markContractSent(conversationId);
  try {
    markRecalled(conversationId, hits.map((h) => h.sessionId));
  } catch {
    // Unrecorded, a pointer may repeat on a later prompt. Nothing worse.
  }
  logContextDelivery({
    sessionId: session.id,
    conversationId,
    delivery,
    bytes: byteLength(output),
    layers: Object.fromEntries(
      [...layers, recalled].map((l) => [l.name, byteLength(l.text)]),
    ),
    recalled: hits.map((h) => h.slug),
  });
}

/**
 * What the user typed in this conversation before now. The transcript is the
 * whole record: adopt's back-fill ingests assistant output only, so the
 * prompts before adoption exist nowhere else. The hook passes its path; the
 * /bertrand command finds it from the cwd claude runs its tools in. Recorded
 * prompt events stand in when there is no transcript to read.
 */
function earlierPrompts(
  sessionId: string,
  conversationId: string,
  transcriptPath?: string,
): string[] {
  const path = transcriptPath || findClaudeTranscript(conversationId);
  const typed = path ? readTypedPrompts(path) : [];
  if (typed.length > 0) return typed;
  return getEventsByType(sessionId, "user.prompt")
    .filter((e) => e.conversationId === conversationId)
    .map((e) => (e.meta as { prompt?: unknown } | null)?.prompt)
    .filter((p): p is string => typeof p === "string")
    .map((p) => p.trim());
}

/** Typed prompts a full delivery's query reaches back over. */
const FULL_QUERY_PROMPTS = 3;

/**
 * Recall for this delivery, or nothing: off unless `contextRecall` is set, and
 * never re-pointing at the current session or one this conversation has
 * already been shown.
 *
 * The query is what this delivery is answering. A reminder answers the one
 * prompt being submitted. A full contract is a conversation's first, so it
 * answers what has been said so far — for an adopted conversation, the
 * prompts from before bertrand was watching (Tier 2.3), and for /bertrand they
 * are the only text there is. Only the last few: a resumed conversation also
 * gets a full delivery, and querying with its whole history would match
 * everything a little.
 */
function recallFor(
  sessionId: string,
  conversationId: string,
  delivery: "full" | "reminder",
  prompt: string,
  transcriptPath?: string,
) {
  if (!isContextRecallEnabled()) return [];
  try {
    const prompts = [prompt];
    if (delivery === "full") {
      prompts.unshift(
        ...earlierPrompts(sessionId, conversationId, transcriptPath).filter((p) => p !== prompt.trim()),
      );
    }
    const query = queryText(prompts, FULL_QUERY_PROMPTS);
    if (!query) return [];
    const exclude = readRecalled(conversationId);
    exclude.add(sessionId);
    return recall(query, { exclude });
  } catch {
    // A recall failure must cost the pointers, never the contract.
    return [];
  }
}
