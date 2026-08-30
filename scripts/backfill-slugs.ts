/**
 * Spot-check (and optionally backfill) derived session slugs over a project
 * DB. This is the verification harness for ELKY-168's quality bar
 * (docs/orca-boundary.md §4c): print every session's current name next to
 * what pause-time derivation would call it.
 *
 *   bun scripts/backfill-slugs.ts                 # dry-run, active project
 *   bun scripts/backfill-slugs.ts --db <path>     # dry-run, any DB copy
 *   bun scripts/backfill-slugs.ts --apply         # write derived slugs
 *   bun scripts/backfill-slugs.ts --apply --force # …including manual rows
 *
 * Dry-run is the default and writes nothing. --apply respects the same rules
 * as the pause path: manual rows are skipped (unless --force) and collisions
 * suffix -2, -3, … rather than stealing another session's identity. Note the
 * DB is migrated on open (the schema needs name_source), so even a dry-run
 * touches the file's schema — point --db at a copy when inspecting real data.
 */

import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { join } from "path";
import { existsSync } from "fs";
import * as schema from "../src/db/schema";
import { _setDb } from "../src/db/client";

function parseArgs(argv: string[]) {
  const args = { db: "", apply: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--db") args.db = argv[++i] ?? "";
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--force") args.force = true;
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

let dbPath = args.db;
if (!dbPath) {
  const { resolveActiveProject } = await import("../src/lib/projects/resolve");
  dbPath = resolveActiveProject().db;
}
if (!existsSync(dbPath)) {
  console.error(`No database at ${dbPath}`);
  process.exit(1);
}

const sqlite = new Database(dbPath);
sqlite.exec("PRAGMA foreign_keys = ON");
const db = drizzle(sqlite, { schema });
migrate(drizzle(sqlite), {
  migrationsFolder: join(import.meta.dir, "..", "src", "db", "migrations"),
});
// Route every query helper (deriveSessionSlug, resolveSlugCollision) at this
// DB instead of the active project's.
_setDb(db);

const { deriveSessionSlug, resolveSlugCollision } = await import(
  "../src/lib/derive-slug"
);
const { setDerivedSessionSlug } = await import("../src/db/queries/sessions");
const { recordSessionAlias } = await import(
  "../src/db/queries/session-aliases"
);

const rows = db
  .select({ session: schema.sessions })
  .from(schema.sessions)
  .orderBy(schema.sessions.startedAt)
  .all();

let derivedCount = 0;
let fallbackCount = 0;
let appliedCount = 0;
let skippedManual = 0;

const pad = (s: string, n: number) =>
  s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n);

console.log(
  `${args.apply ? "APPLY" : "DRY-RUN"} over ${dbPath} (${rows.length} sessions)\n`,
);
console.log(
  `${pad("current name", 44)}  ${pad("derived slug", 40)}  result`,
);
console.log("-".repeat(96));

for (const { session } of rows) {
  const currentName = session.slug;
  const derived = deriveSessionSlug(session.id);

  if (derived) derivedCount++;
  else fallbackCount++;

  let result = derived ? "derived" : "fallback";

  if (args.apply && derived) {
    if (session.nameSource === "manual" && !args.force) {
      skippedManual++;
      result = "skipped (manual)";
    } else {
      const slug = resolveSlugCollision(derived, session.id);
      if (slug !== session.slug) {
        // Same contract as the pause path: retire the outgoing name into
        // session_aliases rather than dropping it.
        recordSessionAlias(session.slug, session.id);
        setDerivedSessionSlug(session.id, slug);
        appliedCount++;
        result = slug === derived ? "applied" : `applied as ${slug}`;
      } else {
        result = "unchanged";
      }
    }
  }

  console.log(
    `${pad(currentName, 44)}  ${pad(derived ?? "(null)", 40)}  ${result}`,
  );
}

console.log("-".repeat(96));
const pct = (n: number) =>
  rows.length ? `${Math.round((n / rows.length) * 100)}%` : "0%";
console.log(
  `derived ${derivedCount} (${pct(derivedCount)}) · fallback-null ${fallbackCount} (${pct(fallbackCount)})`,
);
if (args.apply) {
  console.log(`applied ${appliedCount} · skipped manual ${skippedManual}`);
}
