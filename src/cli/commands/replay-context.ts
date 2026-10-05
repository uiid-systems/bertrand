import { register } from "@/cli/router";
import { resolveSessionByName } from "@/db/queries/sessions";
import { getConversationsBySession } from "@/db/queries/conversations";
import { replayContract } from "@/contract/layers";
import { parseDbTime } from "@/lib/format";

/**
 * Print the system prompt for one arm of the Tier 3 replay
 * (docs/context-budget.md). Internal: a harness pipes the task's prompt in
 * and hands the output to `claude -p --append-system-prompt`.
 *
 *   bertrand replay-context --session <name> --as-of <time> --arm control|treatment
 *     [--conversation <id>]  < prompt
 *
 * `--as-of` takes ISO or sqlite time; history from that moment on is
 * invisible to the treatment arm, so a replay can't be handed its own answer.
 */
register("replay-context", async (args) => {
  const value = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? undefined : args[i + 1];
  };
  const fail = (message: string): never => {
    console.error(message);
    process.exit(1);
  };

  const name = value("session") ?? fail("--session <name> is required");
  const asOf = value("as-of") ?? fail("--as-of <time> is required");
  if (Number.isNaN(parseDbTime(asOf))) fail(`--as-of: not a time: ${asOf}`);
  const arm = value("arm");
  if (arm !== "control" && arm !== "treatment") fail("--arm must be control or treatment");

  const resolved = resolveSessionByName(name) ?? fail(`Session not found: ${name}`);
  // Full id or the 8-char prefix `bertrand log` shows.
  const wanted = value("conversation");
  const conversationId = wanted
    ? (getConversationsBySession(resolved.session.id).find((c) => c.id.startsWith(wanted))?.id ??
      fail(`No conversation ${wanted} in ${resolved.slug}`))
    : undefined;
  process.stdout.write(
    replayContract({
      sessionId: resolved.session.id,
      slug: resolved.slug,
      conversationId,
      asOf,
      prompt: await Bun.stdin.text(),
      arm: arm as "control" | "treatment",
    }),
  );
});
