import { register } from "@/cli/router";
import { getSession } from "@/db/queries/sessions";
import { getCategory } from "@/db/queries/categories";
import { buildContract } from "@/contract/template";
import { buildSiblingContext } from "@/contract/context";

/**
 * Print the session contract to stdout. Hook-facing.
 *
 * The contract is normally delivered once via `--append-system-prompt` on
 * bertrand's own `spawn("claude", …)` (see engine/process.ts). That's an argv
 * channel — it reaches exactly one process. Any Claude that runs inside the
 * bertrand environment but was *not* spawned by launchClaude (background jobs,
 * nested `claude` invocations, the Warp plugin's own launcher) inherits the
 * BERTRAND_* env vars — so every hook fires and treats it as a real session —
 * but never receives the contract argv.
 *
 * This command lets the UserPromptSubmit hook re-deliver the contract through
 * the durable env/hook channel, so the guidance reaches those sessions too.
 * It mirrors exactly what engine/session.ts builds at launch.
 *
 * `--short` emits a one-line reminder instead of the full contract, for turns
 * after the first where the full text is already in context.
 */
register("contract", async (args) => {
  let sessionId = "";
  let short = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === "--session-id" && next) {
      sessionId = next;
      i++;
    } else if (arg === "--short") {
      short = true;
    }
  }

  if (!sessionId) {
    console.error("Usage: bertrand contract --session-id <id> [--short]");
    process.exit(1);
  }

  const session = getSession(sessionId);
  if (!session) return; // unknown session → emit nothing, hook injects no context

  const category = getCategory(session.categoryId);
  const categoryPath = category?.path ?? "";
  const sessionName = categoryPath ? `${categoryPath}/${session.slug}` : session.slug;

  if (short) {
    process.stdout.write(
      `Reminder — you are in bertrand session ${sessionName}: end this turn with an AskUserQuestion call (multiSelect:true on every question, plus a "Done for now" option) preceded by a <recap> block.`,
    );
    return;
  }

  const siblingContext = buildSiblingContext(
    session.categoryId,
    categoryPath,
    session.id,
  );
  process.stdout.write(buildContract(sessionName, siblingContext));
});
