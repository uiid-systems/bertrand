import { existsSync } from "fs";
import { register } from "@/cli/router";
import { getDb, getDbForProject } from "@/db/client";
import { listProjects } from "@/lib/projects/registry";
import { projectPaths } from "@/lib/projects/paths";
import { resolveActiveProject } from "@/lib/projects/resolve";
import { applyProjectFlag, extractProjectFlag } from "@/lib/projects/cli-flag";
import {
  searchProject,
  DEFAULT_LIMIT,
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
                                [--session <category>/<slug>] [--limit <n>]
                                [--project <slug> | --all-projects]
Terms are AND-ed, case-insensitive. Default types: everything except tool.`;

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
  console.log(hits.map((h) => "  " + JSON.stringify(h)).join(",\n"));
  console.log("]");
}

register("search", async (args) => {
  const { project: projectSlug, rest } = extractProjectFlag(args);
  applyProjectFlag(projectSlug);

  let allProjects = false;
  let types: SearchType[] | undefined;
  let session: string | undefined;
  let limit: number | undefined;
  const terms: string[] = [];

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    switch (arg) {
      case "--all-projects":
        allProjects = true;
        break;
      case "--json": // output is always JSON; accepted for symmetry
        break;
      case "--type":
      case "--session":
      case "--limit": {
        const value = rest[++i];
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
  if (allProjects && projectSlug) fail("--all-projects and --project are mutually exclusive.");

  const opts = { terms, types, session, limit };

  if (allProjects) {
    const hits: SearchHit[] = [];
    for (const project of listProjects()) {
      // A registry entry with no local DB file was never opened on this
      // machine — skip it explicitly. getDbForProject would CREATE and
      // migrate an empty DB as a side effect of the read, and stray
      // bertrand.db files are the sentinel project recovery scans for.
      if (!existsSync(projectPaths(project.slug).db)) continue;
      try {
        hits.push(...searchProject(getDbForProject(project.slug), project.slug, opts));
      } catch {
        // Unreadable or mid-migration DB — skip it rather than failing the sweep.
      }
    }
    hits.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    printHits(hits.slice(0, limit ?? DEFAULT_LIMIT));
    return;
  }

  const active = resolveActiveProject();
  printHits(searchProject(getDb(), active.slug, opts));
});
