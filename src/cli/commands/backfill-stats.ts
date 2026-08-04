import { register } from "@/cli/router";
import { getAllSessions } from "@/db/queries/sessions";
import { computeAndPersist } from "@/lib/timing";
import { backfillConversationUsage } from "@/lib/usage-backfill";

register("backfill-stats", async (args) => {
  const includeArchived = args.includes("--include-archived");
  const rows = getAllSessions({ excludeArchived: !includeArchived });

  // Token totals first: session stats roll up from conversations, so this has
  // to land before the per-session pass below reads them.
  const usage = backfillConversationUsage();
  console.log(
    `Scored ${usage.scored} conversation(s) from transcripts` +
      (usage.noTranscript ? `, ${usage.noTranscript} without a transcript` : "") +
      (usage.notIngested ? `, ${usage.notIngested} not yet ingested` : "") +
      ".",
  );

  console.log(
    `Backfilling stats for ${rows.length} session(s)${includeArchived ? "" : " (excluding archived)"}...`,
  );

  for (const { session, categoryPath } of rows) {
    computeAndPersist(session.id);
    console.log(`  ✓ ${categoryPath}/${session.slug}`);
  }

  console.log("Done.");
});
