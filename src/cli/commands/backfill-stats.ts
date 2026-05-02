import { register } from "@/cli/router";
import { getAllSessions } from "@/db/queries/sessions";
import { computeAndPersist } from "@/lib/timing";

register("backfill-stats", async (args) => {
  const includeArchived = args.includes("--include-archived");
  const rows = getAllSessions({ excludeArchived: !includeArchived });

  console.log(
    `Backfilling stats for ${rows.length} session(s)${includeArchived ? "" : " (excluding archived)"}...`,
  );

  for (const { session, groupPath } of rows) {
    computeAndPersist(session.id);
    console.log(`  ✓ ${groupPath}/${session.slug}`);
  }

  console.log("Done.");
});
