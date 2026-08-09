import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  _setRegistryDir,
  _getRegistryDir,
  listProjects,
  getActiveProjectSlug,
  getProjectRepo,
} from "@/lib/projects/registry";
import { _resetRepoCache, _setGitRunner, type GitRunner } from "@/lib/github/resolve";
import { projectPaths } from "@/lib/projects/paths";
import { _resetActiveProjectCache } from "@/lib/projects/resolve";
import {
  listSubcommand,
  createSubcommand,
  linkSubcommand,
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
  // Resolutions are TTL-cached by absolute path, so a binding resolved in one
  // test would otherwise answer for the next one.
  _resetRepoCache();
});

afterEach(() => {
  _clearTestDb();
  _setRegistryDir(originalDir);
  delete process.env.BERTRAND_PROJECT;
  _resetActiveProjectCache();
  _setGitRunner(null);
  _resetRepoCache();
  rmSync(tmpRoot, { recursive: true, force: true });
});

/**
 * A fake `git` covering the three questions `resolveRepoAt` asks. Keys are
 * main-worktree paths; a missing key is "not a repo", a null value is "repo
 * with no origin".
 */
function fakeGit(remotes: Record<string, string | null>): GitRunner {
  return async (cwd, args) => {
    if (args[0] === "worktree") {
      if (!(cwd in remotes)) throw new Error("not a git repository");
      return `worktree ${cwd}\nHEAD abc123\n`;
    }
    if (args[0] === "config") {
      const url = remotes[cwd];
      if (!url) throw new Error("key does not exist");
      return url;
    }
    if (args[0] === "symbolic-ref") return "origin/main";
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
}

/** {@link withCapturedOutput} for the subcommands that are async. */
async function withCapturedOutputAsync(
  fn: () => Promise<void>,
): Promise<{ out: string[]; err: string[] }> {
  const origLog = console.log;
  const origErr = console.error;
  const out: string[] = [];
  const err: string[] = [];
  console.log = (...args: unknown[]) => out.push(args.join(" "));
  console.error = (...args: unknown[]) => err.push(args.join(" "));
  try {
    await fn();
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  return { out, err };
}

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
async function seedProject(
  slug: string,
  opts: { activate?: boolean } = {},
): Promise<void> {
  await createSubcommand(opts.activate ? [slug, "--activate"] : [slug]);
}

describe("project create", () => {
  test("happy path: creates registry entry and project dir", async () => {
    await createSubcommand(["acme"]);
    expect(listProjects().map((p) => p.slug)).toEqual(["acme"]);
    expect(existsSync(projectPaths("acme").db)).toBe(true);
  });

  test("--name overrides display name", async () => {
    await createSubcommand(["acme", "--name", "Acme Corp"]);
    const entry = listProjects().find((p) => p.slug === "acme");
    expect(entry?.name).toBe("Acme Corp");
  });

  test("--name=value form is supported (GNU-style)", async () => {
    await createSubcommand(["acme", "--name=Acme"]);
    const entry = listProjects().find((p) => p.slug === "acme");
    expect(entry?.name).toBe("Acme");
  });

  test("defaults name to slug when --name omitted", async () => {
    await createSubcommand(["personal"]);
    const entry = listProjects().find((p) => p.slug === "personal");
    expect(entry?.name).toBe("personal");
  });

  test("--activate sets the active slug", async () => {
    await seedProject("first", { activate: true });
    expect(getActiveProjectSlug()).toBe("first");
    await createSubcommand(["second", "--activate"]);
    expect(getActiveProjectSlug()).toBe("second");
  });

  test("rejects duplicate slug", async () => {
    await createSubcommand(["acme"]);
    // `rejects`, not `toThrow`: createSubcommand is async, and bun's toThrow
    // passes vacuously on an un-awaited rejected promise.
    await expect(createSubcommand(["acme"])).rejects.toThrow(_UsageError);
    await expect(createSubcommand(["acme"])).rejects.toThrow(/already exists/);
  });

  test("rejects invalid slug characters", async () => {
    await expect(createSubcommand(["bad slug"])).rejects.toThrow(/Invalid slug/);
    await expect(createSubcommand(["-leading-dash"])).rejects.toThrow(/Invalid slug/);
  });

  test("rejects missing slug", async () => {
    await expect(createSubcommand([])).rejects.toThrow(/Slug required/);
  });
});

describe("project list", () => {
  test("empty registry prints 'No projects'", async () => {
    const { out } = withCapturedOutput(() => listSubcommand([]));
    expect(out.some((l) => l.includes("No projects"))).toBe(true);
  });

  test("table includes active marker on the active slug", async () => {
    await seedProject("a", { activate: true });
    await seedProject("b");
    const { out } = withCapturedOutput(() => listSubcommand([]));
    const aLine = out.find((l) => l.includes(" a "));
    const bLine = out.find((l) => l.includes(" b "));
    expect(aLine).toContain("*");
    expect(bLine).not.toContain("*");
  });

  test("--json emits parseable structured output", async () => {
    await seedProject("a", { activate: true });
    await seedProject("b");
    const { out } = withCapturedOutput(() => listSubcommand(["--json"]));
    const parsed = JSON.parse(out.join("\n")) as Array<{ slug: string; active: boolean }>;
    expect(parsed.map((p) => p.slug).sort()).toEqual(["a", "b"]);
    expect(parsed.find((p) => p.slug === "a")?.active).toBe(true);
    expect(parsed.find((p) => p.slug === "b")?.active).toBe(false);
  });
});

describe("project switch", () => {
  test("happy path: updates active slug", async () => {
    await seedProject("a", { activate: true });
    await seedProject("b");
    switchSubcommand(["b"]);
    expect(getActiveProjectSlug()).toBe("b");
  });

  test("rejects unknown slug", async () => {
    await seedProject("a", { activate: true });
    expect(() => switchSubcommand(["unknown"])).toThrow(/Unknown project/);
  });

  test("refuses when current project has active sessions", async () => {
    await seedProject("with-live", { activate: true });
    await seedProject("target");
    // Insert an active session into the currently-active project's DB
    const cat = createCategory({ slug: "test", name: "Test" });
    const session = createSession({ categoryId: cat.id, slug: "live-1", name: "live-1" });
    updateSessionStatus(session.id, "active");

    expect(() => switchSubcommand(["target"])).toThrow(/Pause them first/);
  });

  test("rejects missing slug", async () => {
    expect(() => switchSubcommand([])).toThrow(/Usage/);
  });
});

describe("project current", () => {
  test("prints active project metadata", async () => {
    await seedProject("acme", { activate: true });
    const { out } = withCapturedOutput(() => currentSubcommand([]));
    const joined = out.join("\n");
    expect(joined).toContain("acme");
    expect(joined).toContain("Active project:");
  });

  test("--json emits structured output with paths", async () => {
    await seedProject("acme", { activate: true });
    const { out } = withCapturedOutput(() => currentSubcommand(["--json"]));
    const parsed = JSON.parse(out.join("\n")) as { slug: string; db: string };
    expect(parsed.slug).toBe("acme");
    expect(parsed.db).toContain("bertrand.db");
  });
});

describe("project rename", () => {
  test("updates the display name", async () => {
    await seedProject("acme");
    renameSubcommand(["acme", "Acme", "Corporation"]);
    const entry = listProjects().find((p) => p.slug === "acme");
    expect(entry?.name).toBe("Acme Corporation");
  });

  test("rejects unknown slug", async () => {
    // Seed at least one project so the registry exists; renameProject
    // returns a different error ("No registry to update") on an empty
    // registry, which is correct behavior but a different path.
    await seedProject("real", { activate: true });
    expect(() => renameSubcommand(["nope", "New Name"])).toThrow(/Unknown project/);
  });

  test("rejects missing args", async () => {
    expect(() => renameSubcommand([])).toThrow(/Usage/);
    expect(() => renameSubcommand(["onlyone"])).toThrow(/Usage/);
  });
});

describe("project remove", () => {
  test("refuses to remove the active project", async () => {
    await seedProject("acme", { activate: true });
    expect(() => removeSubcommand(["acme"])).toThrow(/Cannot remove the active/);
  });

  test("refuses if the project has sessions without --force", async () => {
    await seedProject("a", { activate: true });
    await seedProject("with-sessions");
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

  test("--force removes a non-empty project's registry entry", async () => {
    await seedProject("a", { activate: true });
    await seedProject("doomed");
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

  test("--purge also removes the directory", async () => {
    await seedProject("a", { activate: true });
    await seedProject("doomed");
    expect(existsSync(projectPaths("doomed").root)).toBe(true);
    removeSubcommand(["doomed", "--purge"]);
    expect(existsSync(projectPaths("doomed").root)).toBe(false);
  });

  test("rejects unknown slug", async () => {
    await seedProject("a", { activate: true });
    expect(() => removeSubcommand(["nope"])).toThrow(/Unknown project/);
  });
});

describe("project link", () => {
  const GH = { "/src/acme": "git@github.com:acme/web.git" };

  test("binds the project and persists it to the registry", async () => {
    await seedProject("acme", { activate: true });
    _setGitRunner(fakeGit(GH));

    const { out } = await withCapturedOutputAsync(() =>
      linkSubcommand(["acme", "/src/acme"]),
    );

    expect(getProjectRepo("acme")?.provider).toEqual({
      provider: "github",
      owner: "acme",
      repo: "web",
    });
    expect(getProjectRepo("acme")?.path).toBe("/src/acme");
    expect(out.join("\n")).toContain("acme/web");
  });

  test("records the default branch when git reports one", async () => {
    await seedProject("acme", { activate: true });
    _setGitRunner(fakeGit(GH));
    await withCapturedOutputAsync(() => linkSubcommand(["acme", "/src/acme"]));
    expect(getProjectRepo("acme")?.defaultBranch).toBe("main");
  });

  test("rejects an unknown slug", async () => {
    await seedProject("acme", { activate: true });
    _setGitRunner(fakeGit(GH));
    await expect(linkSubcommand(["ghost", "/src/acme"])).rejects.toThrow(/Unknown project/);
  });

  test("rejects missing args with usage", async () => {
    await expect(linkSubcommand([])).rejects.toThrow(/Usage/);
    await expect(linkSubcommand(["acme"])).rejects.toThrow(/Usage/);
  });

  test("rejects a non-git path with an actionable message", async () => {
    await seedProject("acme", { activate: true });
    _setGitRunner(fakeGit({}));
    await expect(linkSubcommand(["acme", "/src/nope"])).rejects.toThrow(/git init/);
    expect(getProjectRepo("acme")).toBeUndefined();
  });

  test("rejects a non-GitHub remote", async () => {
    await seedProject("acme", { activate: true });
    _setGitRunner(fakeGit({ "/src/acme": "git@gitlab.com:acme/web.git" }));
    await expect(linkSubcommand(["acme", "/src/acme"])).rejects.toThrow(/Only GitHub remotes/);
    expect(getProjectRepo("acme")).toBeUndefined();
  });

  test("refuses to bind a repo another project already owns", async () => {
    await seedProject("acme", { activate: true });
    await seedProject("other");
    _setGitRunner(fakeGit(GH));
    await withCapturedOutputAsync(() => linkSubcommand(["acme", "/src/acme"]));

    await expect(linkSubcommand(["other", "/src/acme"])).rejects.toThrow(
      /already attached to project "acme"/,
    );
    expect(getProjectRepo("other")).toBeUndefined();
  });

  test("re-linking a project to the same repo is allowed", async () => {
    await seedProject("acme", { activate: true });
    _setGitRunner(fakeGit(GH));
    await withCapturedOutputAsync(() => linkSubcommand(["acme", "/src/acme"]));
    await withCapturedOutputAsync(() => linkSubcommand(["acme", "/src/acme"]));
    expect(getProjectRepo("acme")?.provider.repo).toBe("web");
  });

  test("notes the previous repo when re-pointing a project", async () => {
    await seedProject("acme", { activate: true });
    _setGitRunner(
      fakeGit({ "/src/acme": "git@github.com:acme/web.git", "/src/next": "git@github.com:acme/api.git" }),
    );
    await withCapturedOutputAsync(() => linkSubcommand(["acme", "/src/acme"]));
    const { out } = await withCapturedOutputAsync(() => linkSubcommand(["acme", "/src/next"]));

    expect(getProjectRepo("acme")?.provider.repo).toBe("api");
    expect(out.join("\n")).toContain("was acme/web");
  });
});

describe("project create --repo", () => {
  test("creates and binds in one step", async () => {
    _setGitRunner(fakeGit({ "/src/acme": "git@github.com:acme/web.git" }));
    await withCapturedOutputAsync(() => createSubcommand(["acme", "--repo", "/src/acme"]));

    expect(listProjects().map((p) => p.slug)).toEqual(["acme"]);
    expect(getProjectRepo("acme")?.provider.repo).toBe("web");
  });

  test("--repo=value form is supported", async () => {
    _setGitRunner(fakeGit({ "/src/acme": "git@github.com:acme/web.git" }));
    await withCapturedOutputAsync(() => createSubcommand(["acme", "--repo=/src/acme"]));
    expect(getProjectRepo("acme")?.provider.owner).toBe("acme");
  });

  test("an unbindable path creates no project at all", async () => {
    _setGitRunner(fakeGit({}));
    await expect(createSubcommand(["acme", "--repo", "/src/nope"])).rejects.toThrow(/not a git/);
    expect(listProjects()).toEqual([]);
  });

  test("refuses a repo another project already owns, creating nothing", async () => {
    _setGitRunner(fakeGit({ "/src/acme": "git@github.com:acme/web.git" }));
    await withCapturedOutputAsync(() => createSubcommand(["acme", "--repo", "/src/acme"]));

    await expect(createSubcommand(["dupe", "--repo", "/src/acme"])).rejects.toThrow(
      /already attached/,
    );
    expect(listProjects().map((p) => p.slug)).toEqual(["acme"]);
  });

  test("--repo without a value is a usage error", async () => {
    await expect(createSubcommand(["acme", "--repo"])).rejects.toThrow(/--repo requires a path/);
    expect(listProjects()).toEqual([]);
  });
});

describe("repo binding in list and current", () => {
  test("list --json carries the binding, and null when unlinked", async () => {
    await seedProject("bound", { activate: true });
    await seedProject("loose");
    _setGitRunner(fakeGit({ "/src/acme": "git@github.com:acme/web.git" }));
    await withCapturedOutputAsync(() => linkSubcommand(["bound", "/src/acme"]));

    const { out } = withCapturedOutput(() => listSubcommand(["--json"]));
    const parsed = JSON.parse(out.join("\n")) as Array<{
      slug: string;
      repo: { provider: { owner: string; repo: string }; path: string } | null;
    }>;

    expect(parsed.find((p) => p.slug === "bound")?.repo?.provider.repo).toBe("web");
    expect(parsed.find((p) => p.slug === "loose")?.repo).toBeNull();
  });

  test("list table marks unlinked projects", async () => {
    await seedProject("loose", { activate: true });
    const { out } = withCapturedOutput(() => listSubcommand([]));
    expect(out.join("\n")).toContain("unlinked");
  });

  test("current prints the binding", async () => {
    await seedProject("acme", { activate: true });
    _setGitRunner(fakeGit({ "/src/acme": "git@github.com:acme/web.git" }));
    await withCapturedOutputAsync(() => linkSubcommand(["acme", "/src/acme"]));

    const { out } = withCapturedOutput(() => currentSubcommand([]));
    expect(out.join("\n")).toContain("acme/web");
  });

  test("current names the fix when the project is unlinked", async () => {
    await seedProject("acme", { activate: true });
    const { out } = withCapturedOutput(() => currentSubcommand([]));
    expect(out.join("\n")).toContain("project link acme");
  });

  test("current --json carries the binding", async () => {
    await seedProject("acme", { activate: true });
    _setGitRunner(fakeGit({ "/src/acme": "git@github.com:acme/web.git" }));
    await withCapturedOutputAsync(() => linkSubcommand(["acme", "/src/acme"]));

    const { out } = withCapturedOutput(() => currentSubcommand(["--json"]));
    const parsed = JSON.parse(out.join("\n")) as { repo: { path: string } | null };
    expect(parsed.repo?.path).toBe("/src/acme");
  });
});
