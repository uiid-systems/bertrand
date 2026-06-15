import { existsSync, rmSync } from "fs";
import { register } from "@/cli/router";
import { getDbForProject, invalidateDbCache } from "@/db/client";
import { sessions } from "@/db/schema";
import {
  listProjects,
  getActiveProjectSlug,
  setActiveProjectSlug,
  renameProject,
  removeProject,
} from "@/lib/projects/registry";
import { projectPaths } from "@/lib/projects/paths";
import { createProject } from "@/lib/projects/create";
import { resolveActiveProject, _resetActiveProjectCache } from "@/lib/projects/resolve";
import { formatAgo } from "@/lib/format";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

/**
 * Marker for "the user did something invalid; print this message and exit
 * non-zero". Subcommands throw this instead of calling `process.exit`
 * directly so they're testable without yanking the test runner.
 */
class UsageError extends Error {}

interface SessionCounts {
  total: number;
  active: number;
  /** True when the project's DB couldn't be opened (corrupt, perms, etc.) */
  unreadable?: boolean;
}

const UNREADABLE_COUNTS: SessionCounts = { total: 0, active: 0, unreadable: true };

function countSessions(slug: string): SessionCounts {
  const dbFile = projectPaths(slug).db;
  if (!existsSync(dbFile)) return { total: 0, active: 0 };
  try {
    const db = getDbForProject(slug);
    const all = db
      .select({ status: sessions.status })
      .from(sessions)
      .all();
    return {
      total: all.length,
      active: all.filter((s) => s.status === "active" || s.status === "waiting").length,
    };
  } catch {
    // Corrupt sqlite, bad migration, perms — render as "?" in the list view
    // rather than crashing every subcommand that surveys other projects.
    return UNREADABLE_COUNTS;
  }
}

function validateSlug(slug: string): void {
  if (!slug) {
    throw new UsageError("Slug required.");
  }
  if (!SLUG_PATTERN.test(slug)) {
    throw new UsageError(
      `Invalid slug "${slug}": must start with alphanumeric and contain only letters, digits, dots, underscores, or dashes.`,
    );
  }
}

/**
 * Flags accept either `--name value` or `--name=value` forms. The `=` form
 * is dropped on the floor by a naive `indexOf("--name")` lookup, so we
 * normalize first and let downstream code stay simple.
 */
function flagKey(token: string): string | null {
  if (!token.startsWith("--")) return null;
  const eq = token.indexOf("=");
  return eq === -1 ? token.slice(2) : token.slice(2, eq);
}

function flagInlineValue(token: string): string | null {
  if (!token.startsWith("--")) return null;
  const eq = token.indexOf("=");
  return eq === -1 ? null : token.slice(eq + 1);
}

function parseFlag(args: string[], name: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const key = flagKey(args[i]!);
    if (key !== name) continue;
    const inline = flagInlineValue(args[i]!);
    if (inline !== null) return inline;
    return args[i + 1];
  }
  return undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.some((a) => flagKey(a) === name);
}

function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      // `--name=value` is self-contained; consume one token.
      if (a.includes("=")) continue;
      // `--name value` consumes both. A `--name` followed by another flag
      // (or end of args) is treated as boolean — consume only the flag.
      const next = args[i + 1];
      if (next && !next.startsWith("--")) i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

// ----- subcommands -----

export function listSubcommand(args: string[]): void {
  const isJson = hasFlag(args, "json");
  const projects = listProjects();
  const activeSlug = getActiveProjectSlug();

  const rows = projects.map((p) => ({
    slug: p.slug,
    name: p.name,
    active: p.slug === activeSlug,
    sessions: countSessions(p.slug),
    lastUsedAt: p.lastUsedAt,
  }));

  if (isJson) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  if (rows.length === 0) {
    console.log("No projects registered yet.");
    return;
  }

  const dim = "\x1b[2m";
  const reset = "\x1b[0m";
  const bold = "\x1b[1m";
  const maxSlug = Math.max(...rows.map((r) => r.slug.length), 4);
  const maxName = Math.max(...rows.map((r) => r.name.length), 4);

  console.log(
    `${dim}  ${"SLUG".padEnd(maxSlug)}  ${"NAME".padEnd(maxName)}  ${"SESSIONS".padEnd(10)}  LAST USED${reset}`,
  );
  for (const r of rows) {
    const marker = r.active ? `${bold}*${reset}` : " ";
    const sessionStr = r.sessions.unreadable
      ? "?".padEnd(10)
      : `${r.sessions.total} (${r.sessions.active} active)`.padEnd(10);
    const ago = formatAgo(r.lastUsedAt);
    console.log(
      `${marker} ${r.slug.padEnd(maxSlug)}  ${r.name.padEnd(maxName)}  ${sessionStr}  ${ago}`,
    );
  }
}

export function createSubcommand(args: string[]): void {
  const [slug] = positional(args);
  validateSlug(slug ?? "");
  const customName = parseFlag(args, "name");
  const activate = hasFlag(args, "activate");

  if (listProjects().some((p) => p.slug === slug)) {
    throw new UsageError(`Project "${slug}" already exists.`);
  }

  createProject({ slug: slug!, name: customName });

  if (activate) {
    setActiveProjectSlug(slug!);
    _resetActiveProjectCache();
  }

  console.log(`Created project "${slug}"${activate ? " (now active)" : ""}.`);
}

export function switchSubcommand(args: string[]): void {
  const [slug] = positional(args);
  if (!slug) {
    throw new UsageError("Usage: bertrand project switch <slug>");
  }

  const projects = listProjects();
  if (!projects.some((p) => p.slug === slug)) {
    throw new UsageError(`Unknown project slug "${slug}".`);
  }

  // Refuse if the *current* project has any active/waiting sessions. The
  // hooks for those sessions hold BERTRAND_PROJECT from their spawn-time
  // env, so they'd keep writing to the current project — but the user's
  // foreground intent has shifted, which is confusing. Make them park
  // the live work first.
  const currentSlug = getActiveProjectSlug();
  if (currentSlug !== slug) {
    const counts = countSessions(currentSlug);
    if (counts.active > 0) {
      throw new UsageError(
        `Cannot switch: project "${currentSlug}" has ${counts.active} active/waiting session(s). Pause them first.`,
      );
    }
  }

  setActiveProjectSlug(slug);
  _resetActiveProjectCache();
  console.log(`Switched active project to "${slug}".`);
}

export function currentSubcommand(args: string[]): void {
  const isJson = hasFlag(args, "json");
  const active = resolveActiveProject();
  if (isJson) {
    console.log(JSON.stringify(active, null, 2));
    return;
  }
  console.log(`Active project: ${active.slug} (${active.name})`);
  console.log(`  Root:    ${active.root}`);
  console.log(`  DB:      ${active.db}`);
  console.log(`  SyncEnv: ${active.syncEnv}`);
}

export function renameSubcommand(args: string[]): void {
  const [slug, ...rest] = positional(args);
  const newName = rest.join(" ");
  if (!slug || !newName) {
    throw new UsageError("Usage: bertrand project rename <slug> <new-name>");
  }
  renameProject(slug, newName);
  console.log(`Renamed "${slug}" to "${newName}".`);
}

export function removeSubcommand(args: string[]): void {
  const [slug] = positional(args);
  if (!slug) {
    throw new UsageError(
      "Usage: bertrand project remove <slug> [--force] [--purge]",
    );
  }
  // Defense-in-depth: even though slugs in the registry came through
  // validateSlug at create time, a manually-edited projects.json could
  // smuggle in `..` or `/` and `--purge`'s rmSync would walk above the
  // project root. Re-validate here to close the door.
  validateSlug(slug);

  const force = hasFlag(args, "force");
  const purge = hasFlag(args, "purge");

  const projects = listProjects();
  const entry = projects.find((p) => p.slug === slug);
  if (!entry) {
    throw new UsageError(`Unknown project slug "${slug}".`);
  }

  if (slug === getActiveProjectSlug()) {
    throw new UsageError(
      `Cannot remove the active project "${slug}". Switch to another project first.`,
    );
  }

  if (!force) {
    const counts = countSessions(slug);
    if (counts.total > 0) {
      throw new UsageError(
        `Project "${slug}" has ${counts.total} session(s). Pass --force to remove anyway.`,
      );
    }
  }

  removeProject(slug);
  invalidateDbCache(slug);

  if (purge) {
    rmSync(projectPaths(slug).root, { recursive: true, force: true });
  }

  console.log(
    `Removed project "${slug}"${purge ? " (directory purged)" : " (directory left on disk; pass --purge to delete)"}.`,
  );
}

function printProjectUsage(): void {
  console.log(`
bertrand project — manage projects

Usage:
  bertrand project list [--json]                  List all projects
  bertrand project create <slug> [--name "..."] [--activate]
                                                  Create a new project
  bertrand project switch <slug>                  Set the active project
  bertrand project current [--json]               Show the active project
  bertrand project rename <slug> <new-name>       Rename a project (display name only)
  bertrand project remove <slug> [--force] [--purge]
                                                  Remove a project entry
`.trim());
}

const KNOWN_SUBS = new Set([
  "list",
  "create",
  "switch",
  "current",
  "rename",
  "remove",
]);

register("project", async (args) => {
  const sub = args[0];
  try {
    switch (sub) {
      case "list":
        return listSubcommand(args.slice(1));
      case "create":
        return createSubcommand(args.slice(1));
      case "switch":
        return switchSubcommand(args.slice(1));
      case "current":
        return currentSubcommand(args.slice(1));
      case "rename":
        return renameSubcommand(args.slice(1));
      case "remove":
        return removeSubcommand(args.slice(1));
      case undefined:
      case "--help":
      case "-h":
        printProjectUsage();
        return;
      default:
        throw new UsageError(`Unknown subcommand: ${sub}`);
    }
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(err.message);
      // Re-print usage for unknown subcommands (the user is likely lost);
      // suppress for a known subcommand's input error (they know which
      // command they meant — just show them what went wrong).
      if (sub && !KNOWN_SUBS.has(sub)) {
        printProjectUsage();
      }
      process.exit(1);
    }
    throw err;
  }
});

/**
 * Public for tests. Production code should go through the `register`-ed
 * dispatcher above; the named exports are the testable entry points
 * without the dispatch wrapper (no `process.exit`, no UsageError catch).
 */
export const _UsageError = UsageError;
