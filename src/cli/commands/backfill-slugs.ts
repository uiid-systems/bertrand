import { register } from "@/cli/router";
import {
  getAllSessions,
  setDerivedSessionSlug,
  untakenBranchSlug,
} from "@/db/queries/sessions";
import { recordSessionAlias } from "@/db/queries/session-aliases";

/**
 * The exact shape `placeholderSlug()` issues for a session created without a
 * name. Deliberately narrow: a hand-typed slug that merely begins with "new-"
 * ("new-onboarding-flow") is the user's word and must not be rewritten. The
 * character class covers the old default-nanoid alphabet too, which could emit
 * `-` and `_` — that is where `new-etxcb-` and `new-b_ecel` came from.
 */
export const PLACEHOLDER_SLUG = /^new-[a-z0-9_-]{6}$/;

export interface BackfillSlugsResult {
  renames: { from: string; to: string }[];
  /** Placeholder rows whose cwd was not in a repo — ordinary, not an error. */
  noBranch: number;
  /** Placeholder rows whose branch names no work, or yielded no free name. */
  unusableBranch: number;
}

/**
 * Rename placeholder-slugged sessions after their branch (ELKY-189).
 *
 * Sessions are created 'derived' on the expectation that pause-time derivation
 * will name them from what the conversation was about. The ones that never got
 * there — abandoned, crashed, or simply never carrying a derivable prompt —
 * kept `new-<nanoid>` forever while sitting on a branch that named the work
 * perfectly well. Session creation seeds from the branch now; this is the same
 * rule applied backwards to rows that predate it, through the same
 * {@link untakenBranchSlug} so the two cannot disagree.
 *
 * Three properties make it safe to run against a live corpus:
 *
 *  - the old slug is recorded as an alias *before* the rename, so every
 *    previously-typed name keeps resolving — a stale alias is harmless, a
 *    rename without one strands the session;
 *  - `setDerivedSessionSlug` leaves `name_source` alone, so rows stay
 *    'derived' and a later pause can still improve on the branch name;
 *  - it does not bump `updatedAt`, so renaming sixty sessions doesn't throw
 *    all sixty to the top of the sidebar's recency sort.
 *
 * Idempotent: a renamed row no longer matches {@link PLACEHOLDER_SLUG}.
 */
export function runBackfillSlugs(
  opts: { dryRun?: boolean; includeArchived?: boolean } = {},
): BackfillSlugsResult {
  const rows = getAllSessions({ excludeArchived: !opts.includeArchived });
  const result: BackfillSlugsResult = {
    renames: [],
    noBranch: 0,
    unusableBranch: 0,
  };

  // Names this pass has already handed out. Only load-bearing under --dry-run,
  // where nothing is written and the DB therefore cannot report the collision
  // between two sessions on one branch — but kept unconditionally so the
  // preview and the real run walk identical ground.
  const claimed = new Set<string>();

  for (const { session } of rows) {
    // A manual name is the user's word and is never re-derived, so it is never
    // a placeholder to replace.
    if (session.nameSource !== "derived") continue;
    if (!PLACEHOLDER_SLUG.test(session.slug)) continue;

    const next = untakenBranchSlug(
      session.branch,
      session.id,
      undefined,
      claimed,
    );
    if (!next) {
      if (session.branch) result.unusableBranch++;
      else result.noBranch++;
      continue;
    }

    result.renames.push({ from: session.slug, to: next });
    claimed.add(next);
    if (opts.dryRun) continue;

    recordSessionAlias(session.slug, session.id);
    setDerivedSessionSlug(session.id, next);
  }

  return result;
}

register("backfill-slugs", async (args) => {
  const dryRun = args.includes("--dry-run");
  const includeArchived = args.includes("--include-archived");

  const { renames, noBranch, unusableBranch } = runBackfillSlugs({
    dryRun,
    includeArchived,
  });

  if (renames.length === 0) {
    console.log("No placeholder-slugged sessions to rename.");
  } else {
    console.log(
      `${dryRun ? "Would rename" : "Renamed"} ${renames.length} session(s):`,
    );
    for (const { from, to } of renames) console.log(`  ${from} → ${to}`);
  }

  const skipped: string[] = [];
  if (noBranch) skipped.push(`${noBranch} with no branch recorded`);
  if (unusableBranch)
    skipped.push(`${unusableBranch} whose branch yielded no usable name`);
  if (skipped.length) console.log(`Left alone: ${skipped.join(", ")}.`);

  if (dryRun && renames.length) {
    console.log("\nDry run — nothing was written. Re-run without --dry-run.");
  }
});
