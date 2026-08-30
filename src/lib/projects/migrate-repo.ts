import { copyFileSync, existsSync } from "fs";
import { join } from "path";
import { eq } from "drizzle-orm";
import { getDbForProject } from "@/db/client";
import { events } from "@/db/schema";
import { formatIdentity } from "@/lib/github/identity";
import { resolveRepoAt } from "@/lib/github/resolve";
import {
  _getRegistryDir,
  loadRegistry,
  removeProject,
  setProjectRepo,
} from "./registry";
import type { ProviderIdentity } from "@/lib/github/types";

/**
 * One-shot migration that binds the live registry's surviving projects to
 * their repositories and drops the two that never held real work.
 *
 * Follows {@link import("./migrate-layout").migrateLegacyLayout}: runs before
 * every command, cheap and idempotent on the no-op path, reported rather than
 * silent.
 *
 * It differs in one way that matters. The layout migration is universal —
 * every pre-project install needs it. This one describes *one specific
 * registry*, and bertrand ships to npm, where `default` is the slug the layout
 * migration creates for everybody. Removing it on a stranger's machine would
 * be data loss, so every step below is gated on the registry actually being
 * the one this migration was written for: the slug set has to match, and each
 * detected remote has to match {@link EXPECTED}. Anything else is a no-op, not
 * a best guess.
 */

/** The bindings this migration exists to create, verified on disk. */
const EXPECTED: readonly { slug: string; owner: string; repo: string }[] = [
  { slug: "bertrand", owner: "uiid-systems", repo: "bertrand" },
  { slug: "design-system", owner: "uiid-systems", repo: "design-system" },
  { slug: "shuff-app", owner: "adamfratino", repo: "shuff-app" },
];

/**
 * Projects to drop. Their directories stay on disk — `removeProject` only
 * edits the registry, and `--purge` stays opt-in — so the single session each
 * one holds remains recoverable by re-registering the slug.
 */
const DEAD_SLUGS: readonly string[] = ["default", "self-hosted"];

export interface BoundProject {
  slug: string;
  /** `owner/repo`, as {@link formatIdentity} renders it. For reporting. */
  identity: string;
  /** The repo's **main** checkout, per `resolveRepoAt` — never a worktree. */
  path: string;
  provider: ProviderIdentity;
  defaultBranch?: string;
}

export type RepoMigrationResult =
  | {
      migrated: false;
      reason: "no-registry" | "already-migrated" | "not-this-registry";
    }
  /** No session in the project pointed at a resolvable GitHub checkout. */
  | { migrated: false; reason: "undetectable"; slug: string }
  /** A checkout resolved, but to a different repo than the table promises. */
  | {
      migrated: false;
      reason: "mismatch";
      slug: string;
      expected: string;
      found: string;
    }
  | {
      migrated: true;
      bound: BoundProject[];
      removed: string[];
      /** Absolute path to the pre-migration copy of `projects.json`. */
      backup: string;
    };

/**
 * Ranked candidate checkout paths for a project, most-used first.
 *
 * The source is the session `cwd` recorded on `claude.started`. It can be
 * *inside* the repo rather than at its root (`packages/design-system`); that's
 * fine, because `resolveRepoAt` walks git up to the main checkout. Ranking by
 * frequency is what makes the occasional stray path — a session opened in the
 * wrong project — lose to the real one.
 *
 * Worktree paths were a second source until ELKY-164 dropped the column. Every
 * session now runs in the bound checkout, which `claude.started` already
 * records, so nothing is lost for sessions started since the teardown.
 */
export type PathScanner = (slug: string) => string[];

const defaultPathScanner: PathScanner = (slug) => {
  const db = getDbForProject(slug);
  const counts = new Map<string, number>();
  const bump = (path: string | null | undefined) => {
    if (typeof path !== "string" || path.trim() === "") return;
    counts.set(path, (counts.get(path) ?? 0) + 1);
  };

  for (const row of db
    .select({ meta: events.meta })
    .from(events)
    .where(eq(events.event, "claude.started"))
    .all()) {
    const meta = row.meta as { cwd?: unknown } | null;
    if (meta && typeof meta === "object") bump(meta.cwd as string);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([path]) => path);
};

let _scanner: PathScanner | null = null;

/** Test override for the DB scan, so fixtures don't need real project DBs. */
export function _setPathScanner(scanner: PathScanner | null): void {
  _scanner = scanner;
}

const scan = (slug: string) => (_scanner ?? defaultPathScanner)(slug);

const matches = (identity: ProviderIdentity, want: { owner: string; repo: string }) =>
  identity.owner === want.owner && identity.repo === want.repo;

/**
 * Bind the surviving projects and drop the dead ones.
 *
 * Detection and verification run for *every* project before anything is
 * written, so a single mismatch aborts with the registry untouched rather than
 * leaving half the migration applied.
 */
export async function migrateProjectRepos(): Promise<RepoMigrationResult> {
  const registry = loadRegistry();
  if (!registry) return { migrated: false, reason: "no-registry" };

  const slugs = new Set(registry.projects.map((p) => p.slug));
  const unbound = EXPECTED.filter(
    (e) => !registry.projects.find((p) => p.slug === e.slug)?.repo,
  );
  const dead = DEAD_SLUGS.filter((s) => slugs.has(s));

  // Nothing left to do. Checked before the fingerprint because the migration
  // removes slugs the fingerprint tests for — without this, a completed
  // migration would report "not-this-registry" forever.
  if (unbound.length === 0 && dead.length === 0) {
    return { migrated: false, reason: "already-migrated" };
  }

  // Fingerprint. Every expected project must be present, and the registry must
  // hold nothing beyond the projects this migration knows about. A stranger's
  // registry fails here and never reaches the removals below.
  const known = new Set<string>([...EXPECTED.map((e) => e.slug), ...DEAD_SLUGS]);
  const isThisRegistry =
    EXPECTED.every((e) => slugs.has(e.slug)) &&
    [...slugs].every((s) => known.has(s));
  if (!isThisRegistry) return { migrated: false, reason: "not-this-registry" };

  // Detect and verify everything up front.
  const bound: BoundProject[] = [];
  for (const expected of unbound) {
    let resolved: { identity: ProviderIdentity; path: string; branch?: string } | null =
      null;

    for (const candidate of scan(expected.slug)) {
      if (!existsSync(candidate)) continue;
      const result = await resolveRepoAt(candidate);
      if (!result.ok) continue;
      resolved = {
        identity: result.repo.provider,
        path: result.repo.path,
        branch: result.repo.defaultBranch,
      };
      break;
    }

    if (!resolved) {
      return { migrated: false, reason: "undetectable", slug: expected.slug };
    }
    if (!matches(resolved.identity, expected)) {
      return {
        migrated: false,
        reason: "mismatch",
        slug: expected.slug,
        expected: `${expected.owner}/${expected.repo}`,
        found: formatIdentity(resolved.identity),
      };
    }

    bound.push({
      slug: expected.slug,
      identity: formatIdentity(resolved.identity),
      path: resolved.path,
      provider: resolved.identity,
      ...(resolved.branch ? { defaultBranch: resolved.branch } : {}),
    });
  }

  // Everything verified — back up, then write.
  const registryFile = join(_getRegistryDir(), "projects.json");
  const backup = `${registryFile}.pre-repo-migration`;
  if (existsSync(registryFile)) copyFileSync(registryFile, backup);

  for (const entry of bound) {
    setProjectRepo(entry.slug, {
      path: entry.path,
      provider: entry.provider,
      ...(entry.defaultBranch ? { defaultBranch: entry.defaultBranch } : {}),
    });
  }

  for (const slug of dead) removeProject(slug);

  return { migrated: true, bound, removed: [...dead], backup };
}
