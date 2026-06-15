import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  _setRegistryDir,
  _getRegistryDir,
  listProjects,
  getActiveProjectSlug,
} from "@/lib/projects/registry";
import { projectPaths } from "@/lib/projects/paths";
import { _resetActiveProjectCache } from "@/lib/projects/resolve";
import {
  listSubcommand,
  createSubcommand,
  switchSubcommand,
  currentSubcommand,
  renameSubcommand,
  removeSubcommand,
  _UsageError,
} from "./project";
import { _clearTestDb } from "@/db/client";
import { createSession, updateSessionStatus } from "@/db/queries/sessions";
import { createCategory } from "@/db/queries/categories";

let tmpRoot: string;
const originalDir = _getRegistryDir();

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "bertrand-projcmd-"));
  _setRegistryDir(tmpRoot);
  delete process.env.BERTRAND_PROJECT;
  _resetActiveProjectCache();
  _clearTestDb();
});

afterEach(() => {
  _clearTestDb();
  _setRegistryDir(originalDir);
  delete process.env.BERTRAND_PROJECT;
  _resetActiveProjectCache();
  rmSync(tmpRoot, { recursive: true, force: true });
});

/**
 * Run a subcommand with output captured. Lets tests assert on the
 * console.log / console.error stream without sprinkling spies everywhere.
 */
function withCapturedOutput(fn: () => void): { out: string[]; err: string[] } {
  const origLog = console.log;
  const origErr = console.error;
  const out: string[] = [];
  const err: string[] = [];
  console.log = (...args: unknown[]) => out.push(args.join(" "));
  console.error = (...args: unknown[]) => err.push(args.join(" "));
  try {
    fn();
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  return { out, err };
}

/**
 * Seed a project that's NOT created via the subcommand — direct registry +
 * DB init. Used when we want to set up state without exercising the CLI.
 */
function seedProject(slug: string, opts: { activate?: boolean } = {}): void {
  createSubcommand(opts.activate ? [slug, "--activate"] : [slug]);
}

describe("project create", () => {
  test("happy path: creates registry entry and project dir", () => {
    createSubcommand(["acme"]);
    expect(listProjects().map((p) => p.slug)).toEqual(["acme"]);
    expect(existsSync(projectPaths("acme").db)).toBe(true);
  });

  test("--name overrides display name", () => {
    createSubcommand(["acme", "--name", "Acme Corp"]);
    const entry = listProjects().find((p) => p.slug === "acme");
    expect(entry?.name).toBe("Acme Corp");
  });

  test("defaults name to slug when --name omitted", () => {
    createSubcommand(["personal"]);
    const entry = listProjects().find((p) => p.slug === "personal");
    expect(entry?.name).toBe("personal");
  });

  test("--activate sets the active slug", () => {
    seedProject("first", { activate: true });
    expect(getActiveProjectSlug()).toBe("first");
    createSubcommand(["second", "--activate"]);
    expect(getActiveProjectSlug()).toBe("second");
  });

  test("rejects duplicate slug", () => {
    createSubcommand(["acme"]);
    expect(() => createSubcommand(["acme"])).toThrow(_UsageError);
    expect(() => createSubcommand(["acme"])).toThrow(/already exists/);
  });

  test("rejects invalid slug characters", () => {
    expect(() => createSubcommand(["bad slug"])).toThrow(/Invalid slug/);
    expect(() => createSubcommand(["-leading-dash"])).toThrow(/Invalid slug/);
  });

  test("rejects missing slug", () => {
    expect(() => createSubcommand([])).toThrow(/Slug required/);
  });
});

describe("project list", () => {
  test("empty registry prints 'No projects'", () => {
    const { out } = withCapturedOutput(() => listSubcommand([]));
    expect(out.some((l) => l.includes("No projects"))).toBe(true);
  });

  test("table includes active marker on the active slug", () => {
    seedProject("a", { activate: true });
    seedProject("b");
    const { out } = withCapturedOutput(() => listSubcommand([]));
    const aLine = out.find((l) => l.includes(" a "));
    const bLine = out.find((l) => l.includes(" b "));
    expect(aLine).toContain("*");
    expect(bLine).not.toContain("*");
  });

  test("--json emits parseable structured output", () => {
    seedProject("a", { activate: true });
    seedProject("b");
    const { out } = withCapturedOutput(() => listSubcommand(["--json"]));
    const parsed = JSON.parse(out.join("\n")) as Array<{ slug: string; active: boolean }>;
    expect(parsed.map((p) => p.slug).sort()).toEqual(["a", "b"]);
    expect(parsed.find((p) => p.slug === "a")?.active).toBe(true);
    expect(parsed.find((p) => p.slug === "b")?.active).toBe(false);
  });
});

describe("project switch", () => {
  test("happy path: updates active slug", () => {
    seedProject("a", { activate: true });
    seedProject("b");
    switchSubcommand(["b"]);
    expect(getActiveProjectSlug()).toBe("b");
  });

  test("rejects unknown slug", () => {
    seedProject("a", { activate: true });
    expect(() => switchSubcommand(["unknown"])).toThrow(/Unknown project/);
  });

  test("refuses when current project has active sessions", () => {
    seedProject("with-live", { activate: true });
    seedProject("target");
    // Insert an active session into the currently-active project's DB
    const cat = createCategory({ slug: "test", name: "Test" });
    const session = createSession({ categoryId: cat.id, slug: "live-1", name: "live-1" });
    updateSessionStatus(session.id, "active");

    expect(() => switchSubcommand(["target"])).toThrow(/Pause them first/);
  });

  test("rejects missing slug", () => {
    expect(() => switchSubcommand([])).toThrow(/Usage/);
  });
});

describe("project current", () => {
  test("prints active project metadata", () => {
    seedProject("acme", { activate: true });
    const { out } = withCapturedOutput(() => currentSubcommand([]));
    const joined = out.join("\n");
    expect(joined).toContain("acme");
    expect(joined).toContain("Active project:");
  });

  test("--json emits structured output with paths", () => {
    seedProject("acme", { activate: true });
    const { out } = withCapturedOutput(() => currentSubcommand(["--json"]));
    const parsed = JSON.parse(out.join("\n")) as { slug: string; db: string };
    expect(parsed.slug).toBe("acme");
    expect(parsed.db).toContain("bertrand.db");
  });
});

describe("project rename", () => {
  test("updates the display name", () => {
    seedProject("acme");
    renameSubcommand(["acme", "Acme", "Corporation"]);
    const entry = listProjects().find((p) => p.slug === "acme");
    expect(entry?.name).toBe("Acme Corporation");
  });

  test("rejects unknown slug", () => {
    // Seed at least one project so the registry exists; renameProject
    // returns a different error ("No registry to update") on an empty
    // registry, which is correct behavior but a different path.
    seedProject("real", { activate: true });
    expect(() => renameSubcommand(["nope", "New Name"])).toThrow(/Unknown project/);
  });

  test("rejects missing args", () => {
    expect(() => renameSubcommand([])).toThrow(/Usage/);
    expect(() => renameSubcommand(["onlyone"])).toThrow(/Usage/);
  });
});

describe("project remove", () => {
  test("refuses to remove the active project", () => {
    seedProject("acme", { activate: true });
    expect(() => removeSubcommand(["acme"])).toThrow(/Cannot remove the active/);
  });

  test("refuses if the project has sessions without --force", () => {
    seedProject("a", { activate: true });
    seedProject("with-sessions");
    // Seed a session into the non-active project so countSessions sees it.
    // We point BERTRAND_PROJECT at the target so createSession/createCategory
    // (which use `getDb()` → active project) write into "with-sessions".
    process.env.BERTRAND_PROJECT = "with-sessions";
    _resetActiveProjectCache();
    const c = createCategory({ slug: "test", name: "Test" });
    createSession({ categoryId: c.id, slug: "s1", name: "s1" });
    delete process.env.BERTRAND_PROJECT;
    _resetActiveProjectCache();

    expect(() => removeSubcommand(["with-sessions"])).toThrow(/Pass --force/);
  });

  test("--force removes a non-empty project's registry entry", () => {
    seedProject("a", { activate: true });
    seedProject("doomed");
    process.env.BERTRAND_PROJECT = "doomed";
    _resetActiveProjectCache();
    const c = createCategory({ slug: "test", name: "Test" });
    createSession({ categoryId: c.id, slug: "s1", name: "s1" });
    delete process.env.BERTRAND_PROJECT;
    _resetActiveProjectCache();

    removeSubcommand(["doomed", "--force"]);
    expect(listProjects().map((p) => p.slug)).toEqual(["a"]);
    // Default: directory left on disk
    expect(existsSync(projectPaths("doomed").root)).toBe(true);
  });

  test("--purge also removes the directory", () => {
    seedProject("a", { activate: true });
    seedProject("doomed");
    expect(existsSync(projectPaths("doomed").root)).toBe(true);
    removeSubcommand(["doomed", "--purge"]);
    expect(existsSync(projectPaths("doomed").root)).toBe(false);
  });

  test("rejects unknown slug", () => {
    seedProject("a", { activate: true });
    expect(() => removeSubcommand(["nope"])).toThrow(/Unknown project/);
  });
});
