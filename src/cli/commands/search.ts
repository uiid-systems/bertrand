import { register } from "@/cli/router";
import { getDb } from "@/db/client";
import {
  searchSessions,
  SEARCH_TYPES,
  type SearchHit,
  type SearchType,
} from "@/lib/search";

/**
 * `bertrand search` — find where something was discussed or decided, across
 * sessions, without knowing which one holds it. Pointer-shaped output only
 * (~150 bytes/hit); the drill-in path is
 * `bertrand log <session> --events --conversation <n>`.
 */

const USAGE = `Usage: bertrand search <term…> [--type prompt,question,answer,assistant,summary,tool]
                                [--session <slug>] [--limit <n>]
Terms are AND-ed, case-insensitive. Default types: everything except tool.
Searches every session on this machine — one database now holds them all, so
the old --project / --all-projects flags have nothing left to choose between.`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseTypes(csv: string): SearchType[] {
  const types = csv.split(",").map((t) => t.trim()).filter(Boolean);
  for (const t of types) {
    if (!(SEARCH_TYPES as readonly string[]).includes(t)) {
      fail(`Unknown --type: ${t} (valid: ${SEARCH_TYPES.join(", ")})`);
    }
  }
  return types as SearchType[];
}

/** Valid JSON array, one hit per line — same convention as log --events. */
function printHits(hits: SearchHit[]) {
  if (hits.length === 0) {
    console.log("[]");
    return;
  }
  console.log("[");
  console.log(
    hits
      .map((hit) => "  " + JSON.stringify(hit))
      .join(",\n"),
  );
  console.log("]");
}

register("search", async (args) => {
  let types: SearchType[] | undefined;
  let session: string | undefined;
  let limit: number | undefined;
  const terms: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    switch (arg) {
      case "--json": // output is always JSON; accepted for symmetry
        break;
      case "--type":
      case "--session":
      case "--limit": {
        const value = args[++i];
        if (!value) fail(`${arg} requires a value.\n${USAGE}`);
        if (arg === "--type") types = parseTypes(value);
        else if (arg === "--session") session = value;
        else {
          const n = Number.parseInt(value, 10);
          if (!Number.isInteger(n) || n <= 0) fail(`--limit must be a positive integer, got: ${value}`);
          limit = n;
        }
        break;
      }
      default:
        if (arg.startsWith("--")) fail(`Unknown flag: ${arg}\n${USAGE}`);
        terms.push(arg);
    }
  }

  if (terms.length === 0) fail(USAGE);

  // One database, one sweep. This used to be two code paths — the active
  // project, or a fan-out that opened every registered project's SQLite file
  // in turn, skipped the ones that had never been created, sorted the merged
  // hits and re-applied the limit by hand. All of it existed to search across
  // a boundary that no longer exists.
  printHits(searchSessions(getDb(), { terms, types, session, limit }));
});
