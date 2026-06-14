import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  DEFAULT_PROJECT_SLUG,
  _setRegistryDir,
  _getRegistryDir,
  registerProject,
  setActiveProjectSlug,
} from "./registry";
import { resolveActiveProject, _resetActiveProjectCache } from "./resolve";

let tmpRoot: string;
const originalDir = _getRegistryDir();

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "bertrand-resolve-"));
  _setRegistryDir(tmpRoot);
  delete process.env.BERTRAND_PROJECT;
  _resetActiveProjectCache();
});

afterEach(() => {
  _setRegistryDir(originalDir);
  delete process.env.BERTRAND_PROJECT;
  _resetActiveProjectCache();
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("resolveActiveProject", () => {
  test("falls back to DEFAULT_PROJECT_SLUG when nothing is set", () => {
    const r = resolveActiveProject();
    expect(r.slug).toBe(DEFAULT_PROJECT_SLUG);
    expect(r.name).toBe(DEFAULT_PROJECT_SLUG);
    expect(r.db).toMatch(/projects\/default\/bertrand\.db$/);
    expect(r.syncEnv).toMatch(/projects\/default\/sync\.env$/);
  });

  test("uses the registry's activeProjectSlug when no env var is set", () => {
    registerProject({ slug: "acme", name: "Acme Corp" });
    registerProject({ slug: "personal", name: "Personal" });
    setActiveProjectSlug("personal");

    _resetActiveProjectCache();
    const r = resolveActiveProject();
    expect(r.slug).toBe("personal");
    expect(r.name).toBe("Personal");
  });

  test("BERTRAND_PROJECT env var overrides the registry's active slug", () => {
    registerProject({ slug: "acme", name: "Acme Corp" });
    setActiveProjectSlug("acme");
    process.env.BERTRAND_PROJECT = "override-slug";

    _resetActiveProjectCache();
    const r = resolveActiveProject();
    expect(r.slug).toBe("override-slug");
  });

  test("falls back to the slug as `name` when env-var slug isn't in the registry", () => {
    process.env.BERTRAND_PROJECT = "ghost";
    _resetActiveProjectCache();
    const r = resolveActiveProject();
    expect(r.slug).toBe("ghost");
    expect(r.name).toBe("ghost");
  });

  test("returns the registry's name when the slug matches an entry", () => {
    registerProject({ slug: "acme", name: "Acme Corp" });
    setActiveProjectSlug("acme");
    _resetActiveProjectCache();

    const r = resolveActiveProject();
    expect(r.slug).toBe("acme");
    expect(r.name).toBe("Acme Corp");
  });

  test("is memoized — subsequent calls return the same object", () => {
    const first = resolveActiveProject();
    const second = resolveActiveProject();
    expect(first).toBe(second);
  });

  test("memoization survives registry mutation until cache reset", () => {
    const first = resolveActiveProject();
    registerProject({ slug: "new", name: "New" });
    setActiveProjectSlug("new");
    const stillCached = resolveActiveProject();
    expect(stillCached).toBe(first);
    expect(stillCached.slug).toBe(DEFAULT_PROJECT_SLUG);

    _resetActiveProjectCache();
    const refreshed = resolveActiveProject();
    expect(refreshed.slug).toBe("new");
    expect(refreshed.name).toBe("New");
  });

  test("ignores empty/whitespace env var", () => {
    registerProject({ slug: "acme", name: "Acme" });
    setActiveProjectSlug("acme");
    process.env.BERTRAND_PROJECT = "  ";
    _resetActiveProjectCache();

    const r = resolveActiveProject();
    expect(r.slug).toBe("acme");
  });
});
