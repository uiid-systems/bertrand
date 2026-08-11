import { existsSync, rmSync } from "fs";
import { register } from "@/cli/router";
import { getDbForProject, invalidateDbCache } from "@/db/client";
import { evictProjectFromServer } from "@/lib/projects/evict";
import { sessions } from "@/db/schema";
import {
  listProjects,
  getActiveProjectSlug,
  setActiveProjectSlug,
  renameProject,
  removeProject,
  getProjectRepo,
  setProjectRepo,
  type ProjectRepo,
} from "@/lib/projects/registry";
import { projectPaths, isValidSlug } from "@/lib/projects/paths";
import { createProject } from "@/lib/projects/create";
import { resolveBindableRepo, RepoBindError } from "@/lib/projects/policy";
import { formatIdentity } from "@/lib/github/identity";
import { isDeclaredHost } from "@/lib/github/hosts";
import { resolveActiveProject, _resetActiveProjectCache } from "@/lib/projects/resolve";
import { bootstrapFromInvite } from "@/sync/bootstrap";
import { isInvite } from "@/sync/invite";
import { formatAgo } from "@/lib/format";


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
      active: all.filter(
        (s) =>
          s.status === "active" ||
          s.status === "waiting" ||
          s.status === "blocked",
      ).length,
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
  if (!isValidSlug(slug)) {
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
    // Explicit null rather than an absent key: consumers of `--json` can tell
    // "unbound" from "this build didn't know about bindings".
    repo: p.repo ?? null,
    // Null when unbound. False marks a binding stored before enterprise hosts
    // had to be declared, whose host nothing in config vouches for now.
    repoHostTrusted: p.repo ? isDeclaredHost(p.repo.provider.host) : null,
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
  // An unattached project is the thing the user most likely needs to act on,
  // so it gets a word rather than a blank cell. An undeclared host gets a mark
  // in the cell itself: `github.com.evil.com/o/r` reads as github.com to anyone
  // scanning this column, which is the confusion the allowlist exists to stop.
  const repoLabel = (r: (typeof rows)[number]) =>
    r.repo
      ? `${formatIdentity(r.repo.provider)}${r.repoHostTrusted ? "" : " (!)"}`
      : "unlinked";
  const maxRepo = Math.max(...rows.map((r) => repoLabel(r).length), 4);

  console.log(
    `${dim}  ${"SLUG".padEnd(maxSlug)}  ${"NAME".padEnd(maxName)}  ${"REPO".padEnd(maxRepo)}  ${"SESSIONS".padEnd(10)}  LAST USED${reset}`,
  );
  for (const r of rows) {
    const marker = r.active ? `${bold}*${reset}` : " ";
    const sessionStr = r.sessions.unreadable
      ? "?".padEnd(10)
      : `${r.sessions.total} (${r.sessions.active} active)`.padEnd(10);
    const ago = formatAgo(r.lastUsedAt);
    const repoCell = r.repo
      ? repoLabel(r).padEnd(maxRepo)
      : `${dim}${repoLabel(r).padEnd(maxRepo)}${reset}`;
    console.log(
      `${marker} ${r.slug.padEnd(maxSlug)}  ${r.name.padEnd(maxName)}  ${repoCell}  ${sessionStr}  ${ago}`,
    );
  }

  if (rows.some((r) => r.repoHostTrusted === false)) {
    console.log();
    console.log(`${dim}  (!) host is not declared in github.enterpriseHosts.${reset}`);
    console.log(
      `${dim}      Declare it in ~/.bertrand/config.json, or re-link the project.${reset}`,
    );
  }
}

/**
 * Resolve a path into a binding, restating a policy refusal as a UsageError so
 * it prints and exits non-zero like every other bad-input case. The policy
 * messages are already written for a human, so they pass straight through.
 */
async function bindableRepo(path: string, forSlug?: string): Promise<ProjectRepo> {
  try {
    return await resolveBindableRepo(path, { forSlug });
  } catch (err) {
    if (err instanceof RepoBindError) {
      throw new UsageError(err.message);
    }
    throw err;
  }
}

export async function createSubcommand(args: string[]): Promise<void> {
  const [slug] = positional(args);
  validateSlug(slug ?? "");
  const customName = parseFlag(args, "name");
  const repoPath = parseFlag(args, "repo");
  const activate = hasFlag(args, "activate");

  if (listProjects().some((p) => p.slug === slug)) {
    throw new UsageError(`Project "${slug}" already exists.`);
  }

  if (hasFlag(args, "repo") && !repoPath) {
    throw new UsageError("--repo requires a path to a GitHub checkout.");
  }

  // Resolve before creating: a bad path should leave no project behind, and
  // `bindableRepo` is the slow step (it shells out to git).
  const repo = repoPath ? await bindableRepo(repoPath, slug) : undefined;

  createProject({ slug: slug!, name: customName, repo });

  if (activate) {
    setActiveProjectSlug(slug!);
    _resetActiveProjectCache();
  }

  console.log(`Created project "${slug}"${activate ? " (now active)" : ""}.`);
  if (repo) {
    console.log(`  Repo: ${formatIdentity(repo.provider)} → ${repo.path}`);
  }
}

export async function linkSubcommand(args: string[]): Promise<void> {
  const [slug, path] = positional(args);
  if (!slug || !path) {
    throw new UsageError("Usage: bertrand project link <slug> <path>");
  }

  if (!listProjects().some((p) => p.slug === slug)) {
    throw new UsageError(`Unknown project slug "${slug}".`);
  }

  const repo = await bindableRepo(path, slug);
  const previous = getProjectRepo(slug);
  setProjectRepo(slug, repo);

  console.log(`Linked "${slug}" to ${formatIdentity(repo.provider)}.`);
  console.log(`  Path: ${repo.path}`);
  if (repo.defaultBranch) {
    console.log(`  Default branch: ${repo.defaultBranch}`);
  }
  // Re-linking is legal, but silently swapping which repo a project points at
  // is the kind of thing you want to see confirmed.
  if (previous && formatIdentity(previous.provider) !== formatIdentity(repo.provider)) {
    console.log(`  (was ${formatIdentity(previous.provider)})`);
  }
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
  // Read the binding rather than taking it off `active`: resolveActiveProject
  // is memoized for the process lifetime, so a binding carried on it would go
  // stale the moment `project link` ran in the same process.
  const repo = getProjectRepo(active.slug) ?? null;

  const repoHostTrusted = repo ? isDeclaredHost(repo.provider.host) : null;

  if (isJson) {
    console.log(JSON.stringify({ ...active, repo, repoHostTrusted }, null, 2));
    return;
  }
  console.log(`Active project: ${active.slug} (${active.name})`);
  console.log(`  Root:    ${active.root}`);
  console.log(`  DB:      ${active.db}`);
  console.log(`  SyncEnv: ${active.syncEnv}`);
  if (repo) {
    const mark = repoHostTrusted ? "" : " (!)";
    console.log(`  Repo:    ${formatIdentity(repo.provider)}${mark} → ${repo.path}`);
    if (!repoHostTrusted) {
      console.log(
        `           (!) ${repo.provider.host} is not declared in github.enterpriseHosts.\n` +
          `               Declare it in ~/.bertrand/config.json, or re-link the project.`,
      );
    }
  } else {
    console.log(`  Repo:    unlinked (bertrand project link ${active.slug} <path>)`);
  }
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

export async function removeSubcommand(args: string[]): Promise<void> {
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

  // Both calls above are process-local, and this process is about to exit. A
  // running `bertrand serve` has its own DB cache and its own open descriptors
  // on this project's files, and nothing so far has told it anything happened.
  // Evict before the purge below so the server lets go of the files while they
  // still exist, rather than leaving us to unlink inodes it is still pinning
  // (issue #249).
  const eviction = await evictProjectFromServer(slug);

  if (purge) {
    rmSync(projectPaths(slug).root, { recursive: true, force: true });
  }

  console.log(
    `Removed project "${slug}"${purge ? " (directory purged)" : " (directory left on disk; pass --purge to delete)"}.`,
  );

  // Only worth mentioning when a server answered and declined: the space the
  // user asked for is still held, and restarting is the way to get it back.
  // "No server running" is the normal case and needs no commentary.
  if (purge && eviction.status === "refused") {
    console.log(
      `  Note: the running server would not release "${slug}" (${eviction.message}).\n` +
        `        Its disk space is reclaimed when that server restarts.`,
    );
  }
}

export async function importSubcommand(args: string[]): Promise<void> {
  const [bundle] = positional(args);
  if (!bundle) {
    throw new UsageError("Usage: bertrand project import <bundle>");
  }
  if (!isInvite(bundle)) {
    throw new UsageError(
      `Argument doesn't look like an invite bundle (expected to start with bertrand-sync://). ` +
        `Generate one on the source machine via \`bertrand sync invite\`.`,
    );
  }
  console.log("Importing project from invite…");
  const result = await bootstrapFromInvite(bundle);
  if (!result.ok) {
    throw new UsageError(result.error);
  }
  console.log(
    `✓ Created project "${result.project.slug}" (${result.project.name}) and activated it.`,
  );
  if (result.pulled) {
    console.log(`  Pulled ${result.bytes} bytes in ${result.durationMs}ms.`);
  } else {
    console.log(`  No remote object yet — run \`bertrand sync push\` on the source machine first.`);
  }
}

function printProjectUsage(): void {
  console.log(`
bertrand project — manage projects

Usage:
  bertrand project list [--json]                  List all projects
  bertrand project create <slug> [--name "..."] [--repo <path>] [--activate]
                                                  Create a new project
  bertrand project link <slug> <path>             Attach a project to a GitHub checkout
  bertrand project switch <slug>                  Set the active project
  bertrand project current [--json]               Show the active project
  bertrand project rename <slug> <new-name>       Rename a project (display name only)
  bertrand project remove <slug> [--force] [--purge]
                                                  Remove a project entry
  bertrand project import <bundle>                Import a project from a \`bertrand sync invite\` bundle
`.trim());
}

const KNOWN_SUBS = new Set([
  "list",
  "create",
  "link",
  "switch",
  "current",
  "rename",
  "remove",
  "import",
]);

register("project", async (args) => {
  const sub = args[0];
  try {
    switch (sub) {
      case "list":
        return listSubcommand(args.slice(1));
      // `await`, not `return`: a returned rejection settles outside this
      // try/catch and would skip the UsageError handling below.
      case "create":
        return await createSubcommand(args.slice(1));
      case "link":
        return await linkSubcommand(args.slice(1));
      case "switch":
        return switchSubcommand(args.slice(1));
      case "current":
        return currentSubcommand(args.slice(1));
      case "rename":
        return renameSubcommand(args.slice(1));
      case "remove":
        return await removeSubcommand(args.slice(1));
      case "import":
        return await importSubcommand(args.slice(1));
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
