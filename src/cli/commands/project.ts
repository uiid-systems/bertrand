import { existsSync, mkdirSync, rmSync } from "fs";
import { register } from "@/cli/router";
import { runMigrations } from "@/db/migrate";
import { getDbForProject, invalidateDbCache } from "@/db/client";
import { sessions } from "@/db/schema";
import {
  listProjects,
  getActiveProjectSlug,
  registerProject,
  setActiveProjectSlug,
  renameProject,
  removeProject,
} from "@/lib/projects/registry";
import { projectPaths } from "@/lib/projects/paths";
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
}

function countSessions(slug: string): SessionCounts {
  const dbFile = projectPaths(slug).db;
  if (!existsSync(dbFile)) return { total: 0, active: 0 };
  const db = getDbForProject(slug);
  const all = db
    .select({ status: sessions.status })
    .from(sessions)
    .all();
  return {
    total: all.length,
    active: all.filter((s) => s.status === "active" || s.status === "waiting").length,
  };
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

function parseFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      // Skip the flag and its value (if it looks like a value, not another flag)
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
    const sessionStr = `${r.sessions.total} (${r.sessions.active} active)`.padEnd(10);
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

  // Register in the JSON registry *before* creating the directory. If we
  // create the dir first, `recoverFromDisk` synthesizes a phantom entry
  // for the new slug (because `bertrand.db` was just planted by
  // runMigrations), and `registerProject`'s `loadRegistry()` would then
  // see "already exists" and refuse. Register first, then materialize
  // the on-disk artifacts. On any error during dir/DB creation we roll
  // the registry entry back so the failure mode stays "no entry, no dir".
  registerProject({ slug: slug!, name: customName ?? slug! });
  try {
    const paths = projectPaths(slug!);
    mkdirSync(paths.root, { recursive: true });
    runMigrations(paths.db);
  } catch (err) {
    removeProject(slug!);
    throw err;
  }

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
      if (sub && sub !== "list" && sub !== "create" && sub !== "switch" && sub !== "current" && sub !== "rename" && sub !== "remove") {
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
