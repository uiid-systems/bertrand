import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  DEFAULT_PROJECT_SLUG,
  _setRegistryDir,
  _getRegistryDir,
  loadRegistry,
} from "./registry";
import { projectPaths } from "./paths";
import { _resetActiveProjectCache, resolveActiveProject } from "./resolve";
import { migrateLegacyLayout } from "./migrate-layout";

let tmpRoot: string;
const originalDir = _getRegistryDir();

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "bertrand-migrate-"));
  _setRegistryDir(tmpRoot);
  delete process.env.BERTRAND_PROJECT;
  _resetActiveProjectCache();
});

afterEach(() => {
  _setRegistryDir(originalDir);
  _resetActiveProjectCache();
  rmSync(tmpRoot, { recursive: true, force: true });
});

const legacyDbPath = () => join(tmpRoot, "bertrand.db");
const legacySyncEnvPath = () => join(tmpRoot, "sync.env");

function writeLegacyDb(contents = "fake-sqlite-bytes"): void {
  writeFileSync(legacyDbPath(), contents);
}

describe("migrateLegacyLayout", () => {
  test("fresh install: nothing on disk, no migration performed", () => {
    const result = migrateLegacyLayout();
    expect(result).toEqual({ migrated: false, reason: "fresh-install" });
    expect(existsSync(join(tmpRoot, "projects.json"))).toBe(false);
    expect(existsSync(join(tmpRoot, "projects"))).toBe(false);
  });

  test("happy path: moves bertrand.db into projects/default/ and writes registry", () => {
    writeLegacyDb("payload-marker");
    const result = migrateLegacyLayout();

    expect(result.migrated).toBe(true);
    if (result.migrated) expect(result.moved).toContain("bertrand.db");

    const destDb = projectPaths(DEFAULT_PROJECT_SLUG).db;
    expect(existsSync(destDb)).toBe(true);
    expect(readFileSync(destDb, "utf8")).toBe("payload-marker");
    expect(existsSync(legacyDbPath())).toBe(false);

    const registry = loadRegistry();
    expect(registry?.activeProjectSlug).toBe(DEFAULT_PROJECT_SLUG);
    expect(registry?.projects[0]?.name).toBe("Default");
  });

  test("moves WAL and SHM sidecars alongside the main DB", () => {
    writeLegacyDb("main");
    writeFileSync(legacyDbPath() + "-wal", "wal");
    writeFileSync(legacyDbPath() + "-shm", "shm");

    const result = migrateLegacyLayout();
    expect(result.migrated).toBe(true);
    if (result.migrated) {
      expect(result.moved.sort()).toEqual([
        "bertrand.db",
        "bertrand.db-shm",
        "bertrand.db-wal",
      ]);
    }

    const destDb = projectPaths(DEFAULT_PROJECT_SLUG).db;
    expect(readFileSync(destDb + "-wal", "utf8")).toBe("wal");
    expect(readFileSync(destDb + "-shm", "utf8")).toBe("shm");
  });

  test("moves sync.env preserving its presence (mode is OS-level, not asserted here)", () => {
    writeLegacyDb();
    writeFileSync(legacySyncEnvPath(), "SUPABASE_URL=x");

    const result = migrateLegacyLayout();
    expect(result.migrated).toBe(true);
    if (result.migrated) expect(result.moved).toContain("sync.env");

    const destSync = projectPaths(DEFAULT_PROJECT_SLUG).syncEnv;
    expect(readFileSync(destSync, "utf8")).toBe("SUPABASE_URL=x");
    expect(existsSync(legacySyncEnvPath())).toBe(false);
  });

  test("legacy DB absent but sync.env present still migrates", () => {
    writeFileSync(legacySyncEnvPath(), "SUPABASE_URL=x");
    const result = migrateLegacyLayout();
    expect(result.migrated).toBe(true);
    if (result.migrated) {
      expect(result.moved).toEqual(["sync.env"]);
    }
    expect(loadRegistry()?.projects[0]?.slug).toBe(DEFAULT_PROJECT_SLUG);
  });

  test("idempotent: projects.json already present → no-op", () => {
    // Pre-existing registry — could be from a prior migration or
    // an explicit `bertrand project create`.
    writeFileSync(
      join(tmpRoot, "projects.json"),
      JSON.stringify({
        activeProjectSlug: "acme",
        projects: [
          {
            slug: "acme",
            name: "Acme",
            createdAt: "2026-01-01T00:00:00.000Z",
            lastUsedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );
    writeLegacyDb("would-be-clobbered-if-buggy");

    const result = migrateLegacyLayout();
    expect(result).toEqual({ migrated: false, reason: "already-migrated" });

    // Legacy file untouched
    expect(readFileSync(legacyDbPath(), "utf8")).toBe(
      "would-be-clobbered-if-buggy",
    );
    // No default project synthesized over the existing acme registry
    const registry = loadRegistry();
    expect(registry?.activeProjectSlug).toBe("acme");
  });

  test("defensive idempotency: projects/ exists but projects.json doesn't", () => {
    mkdirSync(join(tmpRoot, "projects"), { recursive: true });
    writeLegacyDb("untouched");

    const result = migrateLegacyLayout();
    expect(result).toEqual({ migrated: false, reason: "already-migrated" });
    expect(readFileSync(legacyDbPath(), "utf8")).toBe("untouched");
  });

  test("invalidates the active-project resolver cache so the registry's name wins", () => {
    // First resolve before any registry exists → fallback to literal "default"
    const beforeMigration = resolveActiveProject();
    expect(beforeMigration.slug).toBe(DEFAULT_PROJECT_SLUG);
    expect(beforeMigration.name).toBe(DEFAULT_PROJECT_SLUG);

    writeLegacyDb();
    migrateLegacyLayout();

    // After migration the registry's `name: "Default"` should win
    const afterMigration = resolveActiveProject();
    expect(afterMigration.slug).toBe(DEFAULT_PROJECT_SLUG);
    expect(afterMigration.name).toBe("Default");
    expect(afterMigration).not.toBe(beforeMigration);
  });
});
