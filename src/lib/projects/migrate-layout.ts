import { existsSync, mkdirSync, renameSync } from "fs";
import { join } from "path";
import { findHolders } from "@/lib/lsof";
import {
  DEFAULT_PROJECT_SLUG,
  _getRegistryDir,
  writeRegistry,
} from "./registry";
import { projectPaths } from "./paths";
import { _resetActiveProjectCache } from "./resolve";

export type MigrationResult =
  | { migrated: false; reason: "already-migrated" | "fresh-install" }
  | { migrated: true; moved: string[] }
  | { migrated: false; reason: "db-held"; holders: { pid: number; command: string }[] };

/**
 * One-shot migration that moves legacy single-DB layout (the pre-project
 * world: `~/.bertrand/bertrand.db` + sidecars + `~/.bertrand/sync.env`)
 * into `~/.bertrand/projects/default/`. Writes `projects.json` with the
 * default project active.
 *
 * Idempotency: skipped if `projects.json` or `projects/<slug>/` already
 * exist. Safe to call on every launch; the no-op branch is cheap.
 *
 * Refusal: if any process (including a rival bertrand) holds the legacy
 * DB open, we refuse rather than rip the file out from under it — a stale
 * WAL pointing at the moved file would corrupt the running session.
 *
 * Side effect on success: clears the active-project resolver cache so
 * subsequent `resolveActiveProject()` calls pick up the new registry
 * (this matters because anything that called the resolver *before*
 * migration cached the literal `"default"` fallback).
 */
export function migrateLegacyLayout(): MigrationResult {
  const root = _getRegistryDir();
  const registryFile = join(root, "projects.json");
  const projectsDir = join(root, "projects");

  // Already migrated — `projects.json` exists, or someone already created
  // a per-project directory under `projects/`. Either signal means the new
  // layout has taken over; don't touch anything.
  if (existsSync(registryFile)) {
    return { migrated: false, reason: "already-migrated" };
  }
  if (existsSync(projectsDir)) {
    // Defensive: the registry file was deleted but per-project dirs survived.
    // recoverFromDisk in the registry will rebuild the JSON next launch.
    return { migrated: false, reason: "already-migrated" };
  }

  // Resolve legacy paths via `_getRegistryDir()` (which tests can override)
  // rather than the hard-coded `paths.db` / `paths.syncEnv`. In production
  // these are identical because the registry dir defaults to `~/.bertrand`;
  // in tests this lets us point at a tmp dir.
  const legacyDb = join(root, "bertrand.db");
  const legacySyncEnv = join(root, "sync.env");

  // Fresh install — neither the legacy DB nor the legacy sync config exists.
  // Nothing to move; `bertrand init` will set up the new layout directly.
  if (!existsSync(legacyDb) && !existsSync(legacySyncEnv)) {
    return { migrated: false, reason: "fresh-install" };
  }

  // Preflight: refuse if any process holds the legacy DB. A rename out from
  // under an open SQLite handle would leave the running session pointing at
  // a deleted-but-still-open file, which guarantees WAL corruption next
  // time it writes.
  //
  // sync.env is intentionally NOT checked here: it's a static config file
  // read once on sync push/pull and never held open across the IO. The
  // only long-lived file descriptor is the SQLite handle.
  if (existsSync(legacyDb)) {
    const holders = findHolders(legacyDb);
    if (holders.length > 0) {
      return { migrated: false, reason: "db-held", holders };
    }
  }

  const destPaths = projectPaths(DEFAULT_PROJECT_SLUG);
  mkdirSync(destPaths.root, { recursive: true });

  const moved: string[] = [];

  // Move the main DB and its WAL/SHM sidecars together. If we move the main
  // file but leave WAL/SHM at the legacy path, SQLite will rebuild from the
  // moved file alone — losing any uncheckpointed writes. Move all three.
  //
  // Partial-rename behavior: renameSync within the same filesystem is
  // effectively atomic per-file but the loop is not atomic across files.
  // If the main DB moves and a sidecar rename then fails (e.g. a permission
  // change between writes), the next launch will see `projects/default/`
  // exists → no-op via the "already-migrated" gate. The stranded sidecar
  // becomes an orphan WAL at ~/.bertrand/; SQLite ignores orphan WAL files
  // (it only consults `${db}-wal`), so the situation is recoverable and
  // mostly cosmetic. The findHolders preflight above prevents the only
  // scenario where uncheckpointed writes could be lost.
  for (const suffix of ["", "-wal", "-shm"] as const) {
    const src = legacyDb + suffix;
    if (!existsSync(src)) continue;
    const dst = destPaths.db + suffix;
    renameSync(src, dst);
    moved.push(`bertrand.db${suffix}`);
  }

  // sync.env is a separate file; renameSync preserves its 0600 mode.
  if (existsSync(legacySyncEnv)) {
    renameSync(legacySyncEnv, destPaths.syncEnv);
    moved.push("sync.env");
  }

  // Plant the default project entry. Use writeRegistry directly (rather
  // than registerProject) because the freshly-moved bertrand.db inside
  // projects/default/ would otherwise trigger recoverFromDisk to synthesize
  // a phantom registry entry, and registerProject would then refuse the
  // "already exists" duplicate.
  //
  // We write `name: "Default"` (capitalized) — this is the only place in
  // the codebase that produces that exact string. The resolver's fallback
  // path (no registry) uses `name: slug` which is the lowercase
  // DEFAULT_PROJECT_SLUG ("default"). The cache reset below ensures any
  // callers that resolved before migration pick up this capitalized form.
  const now = new Date().toISOString();
  writeRegistry({
    activeProjectSlug: DEFAULT_PROJECT_SLUG,
    projects: [
      {
        slug: DEFAULT_PROJECT_SLUG,
        name: "Default",
        createdAt: now,
        lastUsedAt: now,
      },
    ],
  });

  // Force the resolver to re-read on next call. Anything that resolved
  // during the launch sequence before this point saw the literal "default"
  // fallback with the right slug+paths but the wrong `name` ("default" vs
  // "Default"); blow the cache so future callers see the registry's name.
  _resetActiveProjectCache();

  return { migrated: true, moved };
}
