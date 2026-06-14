import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  DEFAULT_PROJECT_SLUG,
  _setRegistryDir,
  _getRegistryDir,
  listProjects,
  getActiveProjectSlug,
  projectExists,
  setActiveProjectSlug,
  registerProject,
  removeProject,
  readRegistry,
  writeRegistry,
  recoverFromDisk,
  loadRegistry,
  type ProjectRegistry,
} from "./registry";

let tmpRoot: string;
const originalDir = _getRegistryDir();

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "bertrand-registry-"));
  _setRegistryDir(tmpRoot);
  delete process.env.BERTRAND_PROJECT;
});

afterEach(() => {
  _setRegistryDir(originalDir);
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("readRegistry", () => {
  test("returns null when projects.json is absent", () => {
    expect(readRegistry()).toBeNull();
  });

  test("returns parsed registry on a valid file", () => {
    const r: ProjectRegistry = {
      activeProjectSlug: "acme",
      projects: [
        { slug: "acme", name: "Acme", createdAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-01T00:00:00.000Z" },
      ],
    };
    writeFileSync(join(tmpRoot, "projects.json"), JSON.stringify(r));
    expect(readRegistry()).toEqual(r);
  });

  test("returns null on malformed JSON", () => {
    writeFileSync(join(tmpRoot, "projects.json"), "{ not json");
    expect(readRegistry()).toBeNull();
  });

  test("returns null when schema is wrong (missing fields)", () => {
    writeFileSync(join(tmpRoot, "projects.json"), JSON.stringify({ activeProjectSlug: "x" }));
    expect(readRegistry()).toBeNull();
  });

  test("returns null when projects entries are malformed", () => {
    writeFileSync(
      join(tmpRoot, "projects.json"),
      JSON.stringify({ activeProjectSlug: "x", projects: [{ slug: "x" }] }),
    );
    expect(readRegistry()).toBeNull();
  });
});

describe("writeRegistry", () => {
  test("creates a parseable projects.json", () => {
    const r: ProjectRegistry = {
      activeProjectSlug: "acme",
      projects: [
        { slug: "acme", name: "Acme", createdAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-01T00:00:00.000Z" },
      ],
    };
    writeRegistry(r);
    const onDisk = JSON.parse(readFileSync(join(tmpRoot, "projects.json"), "utf8"));
    expect(onDisk).toEqual(r);
  });
});

describe("listProjects / getActiveProjectSlug / projectExists", () => {
  test("listProjects returns [] when no registry exists", () => {
    expect(listProjects()).toEqual([]);
  });

  test("getActiveProjectSlug returns DEFAULT_PROJECT_SLUG when no registry exists", () => {
    expect(getActiveProjectSlug()).toBe(DEFAULT_PROJECT_SLUG);
  });

  test("projectExists is false when no registry exists", () => {
    expect(projectExists("anything")).toBe(false);
  });

  test("reflects registered projects", () => {
    registerProject({ slug: "acme", name: "Acme" });
    registerProject({ slug: "personal", name: "Personal" });
    expect(listProjects().map((p) => p.slug).sort()).toEqual(["acme", "personal"]);
    expect(projectExists("acme")).toBe(true);
    expect(projectExists("missing")).toBe(false);
  });
});

describe("registerProject", () => {
  test("adds entry and creates the registry file", () => {
    const entry = registerProject({ slug: "acme", name: "Acme" });
    expect(entry.slug).toBe("acme");
    expect(entry.createdAt).toBeTruthy();
    expect(entry.lastUsedAt).toBeTruthy();
    expect(loadRegistry()?.projects.length).toBe(1);
  });

  test("first registration sets the active slug", () => {
    registerProject({ slug: "acme", name: "Acme" });
    expect(getActiveProjectSlug()).toBe("acme");
  });

  test("rejects duplicate slugs", () => {
    registerProject({ slug: "acme", name: "Acme" });
    expect(() => registerProject({ slug: "acme", name: "Acme Two" })).toThrow(/already exists/);
  });
});

describe("setActiveProjectSlug", () => {
  test("updates active slug and bumps lastUsedAt", () => {
    registerProject({ slug: "a", name: "A" });
    const first = registerProject({ slug: "b", name: "B" });
    setActiveProjectSlug("b");
    expect(getActiveProjectSlug()).toBe("b");
    const after = listProjects().find((p) => p.slug === "b")!;
    expect(after.lastUsedAt >= first.lastUsedAt).toBe(true);
  });

  test("throws on unknown slug", () => {
    registerProject({ slug: "a", name: "A" });
    expect(() => setActiveProjectSlug("nope")).toThrow(/Unknown project slug/);
  });

  test("throws when no registry exists yet", () => {
    expect(() => setActiveProjectSlug("anything")).toThrow(/No registry to update/);
  });
});

describe("removeProject", () => {
  test("removes the entry", () => {
    registerProject({ slug: "a", name: "A" });
    registerProject({ slug: "b", name: "B" });
    removeProject("a");
    expect(listProjects().map((p) => p.slug)).toEqual(["b"]);
  });

  test("resets active to a surviving slug when active is removed", () => {
    registerProject({ slug: "a", name: "A" });
    registerProject({ slug: "b", name: "B" });
    setActiveProjectSlug("a");
    removeProject("a");
    expect(getActiveProjectSlug()).toBe("b");
  });

  test("falls back to DEFAULT_PROJECT_SLUG when the last project is removed", () => {
    registerProject({ slug: "a", name: "A" });
    removeProject("a");
    expect(getActiveProjectSlug()).toBe(DEFAULT_PROJECT_SLUG);
  });

  test("no-op when no registry exists", () => {
    expect(() => removeProject("nope")).not.toThrow();
  });
});

describe("recoverFromDisk", () => {
  test("returns null when projects/ directory is absent", () => {
    expect(recoverFromDisk()).toBeNull();
  });

  test("synthesizes a registry from directory entries", () => {
    mkdirSync(join(tmpRoot, "projects", "acme"), { recursive: true });
    mkdirSync(join(tmpRoot, "projects", "personal"), { recursive: true });
    const r = recoverFromDisk();
    expect(r).not.toBeNull();
    expect(r!.projects.map((p) => p.slug).sort()).toEqual(["acme", "personal"]);
  });

  test("prefers BERTRAND_PROJECT env var when it matches a directory", () => {
    mkdirSync(join(tmpRoot, "projects", "acme"), { recursive: true });
    mkdirSync(join(tmpRoot, "projects", "personal"), { recursive: true });
    process.env.BERTRAND_PROJECT = "personal";
    const r = recoverFromDisk();
    expect(r!.activeProjectSlug).toBe("personal");
  });

  test("falls back to DEFAULT_PROJECT_SLUG if it exists on disk", () => {
    mkdirSync(join(tmpRoot, "projects", DEFAULT_PROJECT_SLUG), { recursive: true });
    mkdirSync(join(tmpRoot, "projects", "zeta"), { recursive: true });
    const r = recoverFromDisk();
    expect(r!.activeProjectSlug).toBe(DEFAULT_PROJECT_SLUG);
  });

  test("falls back to the first alphabetical slug if no default exists", () => {
    mkdirSync(join(tmpRoot, "projects", "beta"), { recursive: true });
    mkdirSync(join(tmpRoot, "projects", "alpha"), { recursive: true });
    const r = recoverFromDisk();
    expect(r!.activeProjectSlug).toBe("alpha");
  });

  test("loadRegistry uses recovery when projects.json is corrupt", () => {
    writeFileSync(join(tmpRoot, "projects.json"), "{ broken");
    mkdirSync(join(tmpRoot, "projects", "acme"), { recursive: true });
    const r = loadRegistry();
    expect(r!.projects.map((p) => p.slug)).toEqual(["acme"]);
  });
});
