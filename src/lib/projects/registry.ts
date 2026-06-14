import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { paths } from "@/lib/paths";

export const DEFAULT_PROJECT_SLUG = "default";

export interface ProjectEntry {
  slug: string;
  name: string;
  createdAt: string;
  lastUsedAt: string;
  color?: string;
}

export interface ProjectRegistry {
  activeProjectSlug: string;
  projects: ProjectEntry[];
}

let _registryDir: string = paths.root;

/**
 * Override the directory under which `projects.json` and `projects/<slug>/`
 * live. Tests inject a temp dir before exercising the registry; production
 * code should never call this.
 */
export function _setRegistryDir(dir: string): void {
  _registryDir = dir;
}

export function _getRegistryDir(): string {
  return _registryDir;
}

function registryPath(): string {
  return join(_registryDir, "projects.json");
}

function projectsDir(): string {
  return join(_registryDir, "projects");
}

/**
 * Read the registry from `<root>/projects.json`. Returns `null` if the
 * file does not exist OR is malformed (caller decides the fallback). The
 * project-directory scan recovery is offered via {@link recoverFromDisk}.
 */
export function readRegistry(): ProjectRegistry | null {
  const path = registryPath();
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRegistry(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Atomically write the registry. Writes to a sibling `.tmp` then renames so
 * a crash mid-write can't leave a half-written `projects.json` (which our
 * own JSON.parse would then reject and silently treat as "no registry").
 */
export function writeRegistry(registry: ProjectRegistry): void {
  const path = registryPath();
  mkdirSync(_registryDir, { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(registry, null, 2) + "\n");
  renameSync(tmp, path);
}

/**
 * Best-effort recovery when `projects.json` is missing or corrupt: enumerate
 * directories under `projects/` and synthesize a registry from filesystem
 * state. `lastUsedAt`/`createdAt` come from the directory mtime so the
 * resulting ordering is at least monotonically sensible.
 *
 * Active slug: the user's `BERTRAND_PROJECT` env var if set and present on
 * disk; otherwise {@link DEFAULT_PROJECT_SLUG} if it exists; otherwise the
 * first slug alphabetically; otherwise no projects → null.
 */
export function recoverFromDisk(): ProjectRegistry | null {
  const dir = projectsDir();
  if (!existsSync(dir)) return null;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }

  const projects: ProjectEntry[] = [];
  for (const slug of entries) {
    const subdir = join(dir, slug);
    let mtime: Date;
    try {
      const s = statSync(subdir);
      if (!s.isDirectory()) continue;
      mtime = new Date(s.mtimeMs);
    } catch {
      continue;
    }
    projects.push({
      slug,
      name: slug,
      createdAt: mtime.toISOString(),
      lastUsedAt: mtime.toISOString(),
    });
  }

  if (projects.length === 0) return null;
  projects.sort((a, b) => a.slug.localeCompare(b.slug));

  const envSlug = process.env.BERTRAND_PROJECT;
  const hasEnv = !!envSlug && projects.some((p) => p.slug === envSlug);
  const hasDefault = projects.some((p) => p.slug === DEFAULT_PROJECT_SLUG);

  const activeProjectSlug = hasEnv
    ? envSlug!
    : hasDefault
      ? DEFAULT_PROJECT_SLUG
      : projects[0]!.slug;

  return { activeProjectSlug, projects };
}

/**
 * Try the registry file first, fall back to a filesystem scan. Both can return
 * null on a truly fresh install; downstream callers (resolver, CLI) treat that
 * as "no projects yet — the literal `default` slug is what's active".
 */
export function loadRegistry(): ProjectRegistry | null {
  return readRegistry() ?? recoverFromDisk();
}

export function listProjects(): ProjectEntry[] {
  return loadRegistry()?.projects ?? [];
}

export function getActiveProjectSlug(): string {
  return loadRegistry()?.activeProjectSlug ?? DEFAULT_PROJECT_SLUG;
}

export function projectExists(slug: string): boolean {
  return listProjects().some((p) => p.slug === slug);
}

export function setActiveProjectSlug(slug: string): void {
  const registry = loadRegistry();
  if (!registry) {
    throw new Error(
      `No registry to update — create a project first (no ${registryPath()} and no ${projectsDir()}/* to recover from)`
    );
  }
  if (!registry.projects.some((p) => p.slug === slug)) {
    throw new Error(`Unknown project slug "${slug}"`);
  }
  registry.activeProjectSlug = slug;
  const idx = registry.projects.findIndex((p) => p.slug === slug);
  if (idx !== -1) {
    registry.projects[idx]!.lastUsedAt = new Date().toISOString();
  }
  writeRegistry(registry);
}

export function registerProject(opts: {
  slug: string;
  name: string;
  color?: string;
}): ProjectEntry {
  const registry = loadRegistry() ?? {
    activeProjectSlug: opts.slug,
    projects: [],
  };
  if (registry.projects.some((p) => p.slug === opts.slug)) {
    throw new Error(`Project "${opts.slug}" already exists`);
  }
  const now = new Date().toISOString();
  const entry: ProjectEntry = {
    slug: opts.slug,
    name: opts.name,
    color: opts.color,
    createdAt: now,
    lastUsedAt: now,
  };
  registry.projects.push(entry);
  writeRegistry(registry);
  return entry;
}

export function removeProject(slug: string): void {
  const registry = loadRegistry();
  if (!registry) return;
  registry.projects = registry.projects.filter((p) => p.slug !== slug);
  if (registry.activeProjectSlug === slug) {
    registry.activeProjectSlug =
      registry.projects[0]?.slug ?? DEFAULT_PROJECT_SLUG;
  }
  writeRegistry(registry);
}

function isRegistry(value: unknown): value is ProjectRegistry {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  if (typeof r.activeProjectSlug !== "string") return false;
  if (!Array.isArray(r.projects)) return false;
  return r.projects.every((p) => {
    if (typeof p !== "object" || p === null) return false;
    const e = p as Record<string, unknown>;
    return (
      typeof e.slug === "string" &&
      typeof e.name === "string" &&
      typeof e.createdAt === "string" &&
      typeof e.lastUsedAt === "string"
    );
  });
}
