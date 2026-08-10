import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { _getRegistryDir, _setRegistryDir, loadRegistry } from "./registry";
import { _resetActiveProjectCache } from "./resolve";
import { _resetRepoCache, _setGitRunner } from "@/lib/github/resolve";
import { _setPathScanner, migrateProjectRepos } from "./migrate-repo";
import type { ProjectEntry } from "./types";

let tmpRoot: string;
const originalDir = _getRegistryDir();

/** Checkout paths the fake git knows about, keyed by directory. */
const REMOTES: Record<string, string> = {
  bertrand: "git@github.com:uiid-systems/bertrand.git",
  "design-system": "git@github.com:uiid-systems/design-system.git",
  "shuff-app": "git@github.com:adamfratino/shuff-app.git",
};

/** Absolute path of a fake checkout inside the tmp root. */
const checkout = (name: string) => join(tmpRoot, "code", name);

/**
 * Stands in for `git`, implementing only the three reads `resolveRepoAt`
 * makes. Any path under a known checkout resolves to that checkout's root,
 * which is how a subdirectory or worktree path resolves to its main tree.
 */
function fakeGit(cwd: string, args: string[]): Promise<string> {
  const name = Object.keys(REMOTES).find(
    (n) => cwd === checkout(n) || cwd.startsWith(`${checkout(n)}/`),
  );
  if (!name) return Promise.reject(new Error("not a git repository"));

  const [cmd, sub] = args;
  if (cmd === "worktree") return Promise.resolve(`worktree ${checkout(name)}\nHEAD abc\n`);
  if (cmd === "config" && sub === "--get") return Promise.resolve(REMOTES[name]!);
  if (cmd === "symbolic-ref") return Promise.resolve("origin/main");
  return Promise.reject(new Error(`unexpected git ${args.join(" ")}`));
}

const entry = (slug: string, extra: Partial<ProjectEntry> = {}): ProjectEntry => ({
  slug,
  name: slug,
  createdAt: "2026-01-01T00:00:00.000Z",
  lastUsedAt: "2026-01-02T00:00:00.000Z",
  ...extra,
});

const registryFile = () => join(tmpRoot, "projects.json");

function writeRegistryFile(projects: ProjectEntry[], active = "bertrand"): void {
  writeFileSync(
    registryFile(),
    JSON.stringify({ activeProjectSlug: active, projects }, null, 2),
  );
}

/** The live registry's shape at the moment this migration was written. */
function writeLiveRegistry(): void {
  writeRegistryFile([
    entry("default"),
    entry("design-system"),
    entry("bertrand"),
    entry("shuff-app"),
    entry("self-hosted"),
  ]);
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "bertrand-migrate-repo-"));
  _setRegistryDir(tmpRoot);
  delete process.env.BERTRAND_PROJECT;
  _resetActiveProjectCache();
  _resetRepoCache();
  _setGitRunner(fakeGit);

  for (const name of Object.keys(REMOTES)) mkdirSync(checkout(name), { recursive: true });

  // Every project's sessions point at its own checkout unless a test says
  // otherwise.
  _setPathScanner((slug) => (slug in REMOTES ? [checkout(slug)] : []));
});

afterEach(() => {
  _setRegistryDir(originalDir);
  _setPathScanner(null);
  _setGitRunner(null);
  _resetRepoCache();
  _resetActiveProjectCache();
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("migrateProjectRepos", () => {
  test("binds the three survivors and removes the two dead projects", async () => {
    writeLiveRegistry();

    const result = await migrateProjectRepos();

    expect(result.migrated).toBe(true);
    if (!result.migrated) return;
    expect(result.bound.map((b) => b.identity).sort()).toEqual([
      "adamfratino/shuff-app",
      "uiid-systems/bertrand",
      "uiid-systems/design-system",
    ]);
    expect(result.removed.sort()).toEqual(["default", "self-hosted"]);

    const after = loadRegistry()!;
    expect(after.projects.map((p) => p.slug).sort()).toEqual([
      "bertrand",
      "design-system",
      "shuff-app",
    ]);
    expect(after.projects.find((p) => p.slug === "bertrand")!.repo).toEqual({
      path: checkout("bertrand"),
      provider: { provider: "github", owner: "uiid-systems", repo: "bertrand" },
      defaultBranch: "main",
    });
  });

  test("re-running is a no-op", async () => {
    writeLiveRegistry();
    await migrateProjectRepos();
    const afterFirst = readFileSync(registryFile(), "utf8");

    const second = await migrateProjectRepos();

    expect(second).toEqual({ migrated: false, reason: "already-migrated" });
    expect(readFileSync(registryFile(), "utf8")).toBe(afterFirst);
  });

  test("backs up projects.json before writing", async () => {
    writeLiveRegistry();
    const before = readFileSync(registryFile(), "utf8");

    const result = await migrateProjectRepos();

    expect(result.migrated).toBe(true);
    if (!result.migrated) return;
    expect(existsSync(result.backup)).toBe(true);
    expect(readFileSync(result.backup, "utf8")).toBe(before);
  });

  test("leaves an already-bound project's binding untouched", async () => {
    const bound = {
      path: "/somewhere/else/bertrand",
      provider: { provider: "github" as const, owner: "uiid-systems", repo: "bertrand" },
    };
    writeRegistryFile([
      entry("bertrand", { repo: bound }),
      entry("design-system"),
      entry("shuff-app"),
      entry("default"),
      entry("self-hosted"),
    ]);

    const result = await migrateProjectRepos();

    expect(result.migrated).toBe(true);
    if (!result.migrated) return;
    // Only the two unbound projects are reported as newly bound.
    expect(result.bound.map((b) => b.slug).sort()).toEqual(["design-system", "shuff-app"]);
    expect(loadRegistry()!.projects.find((p) => p.slug === "bertrand")!.repo).toEqual(bound);
  });

  test("ranks candidates by frequency, so a stray path loses", async () => {
    writeLiveRegistry();
    // design-system's DB holds one session opened in the bertrand checkout —
    // the real registry has exactly this, outvoted 20:1.
    _setPathScanner((slug) =>
      slug === "design-system"
        ? [checkout("design-system"), checkout("bertrand")]
        : [checkout(slug)],
    );

    const result = await migrateProjectRepos();

    expect(result.migrated).toBe(true);
    if (!result.migrated) return;
    expect(result.bound.find((b) => b.slug === "design-system")!.identity).toBe(
      "uiid-systems/design-system",
    );
  });

  test("resolves a subdirectory or worktree path to the main checkout", async () => {
    writeLiveRegistry();
    _setPathScanner((slug) =>
      slug === "shuff-app" ? [join(checkout("shuff-app"), "apps/playground")] : [checkout(slug)],
    );
    mkdirSync(join(checkout("shuff-app"), "apps/playground"), { recursive: true });

    const result = await migrateProjectRepos();

    expect(result.migrated).toBe(true);
    if (!result.migrated) return;
    expect(result.bound.find((b) => b.slug === "shuff-app")!.path).toBe(checkout("shuff-app"));
  });

  test("aborts on a remote that isn't the one the table promises", async () => {
    writeLiveRegistry();
    _setPathScanner((slug) =>
      slug === "shuff-app" ? [checkout("bertrand")] : [checkout(slug)],
    );
    const before = readFileSync(registryFile(), "utf8");

    const result = await migrateProjectRepos();

    expect(result).toEqual({
      migrated: false,
      reason: "mismatch",
      slug: "shuff-app",
      expected: "adamfratino/shuff-app",
      found: "uiid-systems/bertrand",
    });
    // Aborted before any write — including the removals.
    expect(readFileSync(registryFile(), "utf8")).toBe(before);
  });

  test("aborts when a project has no resolvable checkout", async () => {
    writeLiveRegistry();
    _setPathScanner((slug) => (slug === "design-system" ? [] : [checkout(slug)]));
    const before = readFileSync(registryFile(), "utf8");

    const result = await migrateProjectRepos();

    expect(result).toEqual({ migrated: false, reason: "undetectable", slug: "design-system" });
    expect(readFileSync(registryFile(), "utf8")).toBe(before);
  });

  test("ignores a candidate path that no longer exists on disk", async () => {
    writeLiveRegistry();
    _setPathScanner((slug) =>
      slug === "bertrand" ? [join(tmpRoot, "code/deleted"), checkout("bertrand")] : [checkout(slug)],
    );

    const result = await migrateProjectRepos();

    expect(result.migrated).toBe(true);
    if (!result.migrated) return;
    expect(result.bound.find((b) => b.slug === "bertrand")!.path).toBe(checkout("bertrand"));
  });

  describe("someone else's registry", () => {
    test("is left alone, and its `default` project survives", async () => {
      writeRegistryFile([entry("default"), entry("my-app")], "default");
      const before = readFileSync(registryFile(), "utf8");

      const result = await migrateProjectRepos();

      expect(result).toEqual({ migrated: false, reason: "not-this-registry" });
      expect(readFileSync(registryFile(), "utf8")).toBe(before);
      expect(loadRegistry()!.projects.map((p) => p.slug)).toContain("default");
    });

    test("is left alone even when the slugs happen to collide", async () => {
      // Same slug set, different remotes: the fingerprint passes but
      // verification must not.
      writeLiveRegistry();
      _setPathScanner(() => [join(tmpRoot, "code/stranger")]);
      mkdirSync(join(tmpRoot, "code/stranger"), { recursive: true });
      const before = readFileSync(registryFile(), "utf8");

      const result = await migrateProjectRepos();

      expect(result.migrated).toBe(false);
      expect(readFileSync(registryFile(), "utf8")).toBe(before);
    });
  });

  test("reports no-registry when there is nothing to migrate", async () => {
    expect(await migrateProjectRepos()).toEqual({ migrated: false, reason: "no-registry" });
  });
});
