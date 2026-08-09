import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { _setRegistryDir, _getRegistryDir, writeRegistry } from "./registry";
import { _resetRepoCache, _setGitRunner, type GitRunner } from "@/lib/github/resolve";
import {
  requireBoundRepo,
  findProjectByRepo,
  resolveBindableRepo,
  RepoBindError,
  UnboundProjectError,
} from "./policy";

let tmpRoot: string;
const originalDir = _getRegistryDir();

/**
 * A fake `git` that answers the three questions `resolveRepoAt` asks. `remotes`
 * maps a main-worktree path to its `origin` URL; a path absent from the map is
 * "not a repo", and a null URL is "repo with no origin".
 */
function fakeGit(remotes: Record<string, string | null>): GitRunner {
  return async (cwd, args) => {
    if (args[0] === "worktree") {
      if (!(cwd in remotes)) throw new Error("not a git repository");
      return `worktree ${cwd}\nHEAD abc123\nbranch refs/heads/main\n`;
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

function seedRegistry(projects: Parameters<typeof writeRegistry>[0]["projects"]): void {
  writeRegistry({ activeProjectSlug: projects[0]?.slug ?? "default", projects });
}

const TS = "2026-01-01T00:00:00.000Z";

function entry(slug: string, repo?: { path: string; owner: string; repo: string; host?: string }) {
  return {
    slug,
    name: slug,
    createdAt: TS,
    lastUsedAt: TS,
    ...(repo
      ? {
          repo: {
            path: repo.path,
            provider: {
              provider: "github" as const,
              owner: repo.owner,
              repo: repo.repo,
              ...(repo.host ? { host: repo.host } : {}),
            },
          },
        }
      : {}),
  };
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "bertrand-policy-"));
  _setRegistryDir(tmpRoot);
  _resetRepoCache();
});

afterEach(() => {
  _setGitRunner(null);
  _resetRepoCache();
  _setRegistryDir(originalDir);
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("requireBoundRepo", () => {
  test("returns the binding for a bound project", () => {
    seedRegistry([entry("acme", { path: "/src/acme", owner: "acme", repo: "web" })]);
    const repo = requireBoundRepo("acme");
    expect(repo.path).toBe("/src/acme");
    expect(repo.provider.owner).toBe("acme");
  });

  test("throws UnboundProjectError for an unbound project", () => {
    seedRegistry([entry("acme")]);
    expect(() => requireBoundRepo("acme")).toThrow(UnboundProjectError);
  });

  test("throws for an unknown slug", () => {
    seedRegistry([entry("acme")]);
    expect(() => requireBoundRepo("ghost")).toThrow(UnboundProjectError);
  });

  test("the message names the command that fixes it", () => {
    seedRegistry([entry("acme")]);
    expect(() => requireBoundRepo("acme")).toThrow(/bertrand project link acme/);
  });
});

describe("findProjectByRepo", () => {
  beforeEach(() => {
    seedRegistry([
      entry("acme", { path: "/src/acme", owner: "Acme", repo: "Web" }),
      entry("ghe", { path: "/src/ghe", owner: "acme", repo: "web", host: "github.acme.com" }),
    ]);
  });

  test("matches owner/repo case-insensitively", () => {
    const found = findProjectByRepo({ provider: "github", owner: "acme", repo: "web" });
    expect(found?.slug).toBe("acme");
  });

  test("does not match the same owner/repo on a different host", () => {
    const found = findProjectByRepo({
      provider: "github",
      owner: "acme",
      repo: "web",
      host: "github.other.com",
    });
    expect(found).toBeUndefined();
  });

  test("matches an enterprise host exactly", () => {
    const found = findProjectByRepo({
      provider: "github",
      owner: "ACME",
      repo: "WEB",
      host: "github.acme.com",
    });
    expect(found?.slug).toBe("ghe");
  });

  test("returns undefined when nothing is bound to it", () => {
    expect(findProjectByRepo({ provider: "github", owner: "nobody", repo: "nope" })).toBeUndefined();
  });
});

describe("resolveBindableRepo", () => {
  test("resolves a GitHub checkout into a binding", async () => {
    seedRegistry([entry("acme")]);
    _setGitRunner(fakeGit({ "/src/acme": "git@github.com:acme/web.git" }));

    const repo = await resolveBindableRepo("/src/acme");
    expect(repo.path).toBe("/src/acme");
    expect(repo.provider).toEqual({ provider: "github", owner: "acme", repo: "web" });
    expect(repo.defaultBranch).toBe("main");
  });

  test("rejects a path that is not a git repository", async () => {
    seedRegistry([entry("acme")]);
    _setGitRunner(fakeGit({}));

    const err = await resolveBindableRepo("/src/nope").catch((e) => e);
    expect(err).toBeInstanceOf(RepoBindError);
    expect(err.reason).toBe("not-a-repo");
    expect(err.message).toMatch(/git init/);
  });

  test("rejects a repository with no origin remote", async () => {
    seedRegistry([entry("acme")]);
    _setGitRunner(fakeGit({ "/src/acme": null }));

    const err = await resolveBindableRepo("/src/acme").catch((e) => e);
    expect(err.reason).toBe("no-remote");
    expect(err.message).toMatch(/remote add origin/);
  });

  test("rejects a non-GitHub remote and quotes it", async () => {
    seedRegistry([entry("acme")]);
    _setGitRunner(fakeGit({ "/src/acme": "git@gitlab.com:acme/web.git" }));

    const err = await resolveBindableRepo("/src/acme").catch((e) => e);
    expect(err.reason).toBe("not-github");
    expect(err.message).toMatch(/gitlab\.com/);
  });

  test("redacts credentials embedded in the quoted remote", async () => {
    seedRegistry([entry("acme")]);
    _setGitRunner(fakeGit({ "/src/acme": "https://dev:ghp_secret@gitlab.com/acme/web.git" }));

    const err = await resolveBindableRepo("/src/acme").catch((e) => e);
    expect(err.reason).toBe("not-github");
    // The host still names the problem; the token never reaches stdout.
    expect(err.message).toMatch(/gitlab\.com/);
    expect(err.message).not.toMatch(/ghp_secret/);
    expect(err.message).not.toMatch(/dev:/);
  });

  test("rejects a repo already bound to another project", async () => {
    seedRegistry([
      entry("acme", { path: "/src/acme", owner: "acme", repo: "web" }),
      entry("other"),
    ]);
    _setGitRunner(fakeGit({ "/src/acme": "git@github.com:acme/web.git" }));

    const err = await resolveBindableRepo("/src/acme", { forSlug: "other" }).catch((e) => e);
    expect(err).toBeInstanceOf(RepoBindError);
    expect(err.reason).toBe("already-bound");
    expect(err.message).toMatch(/already attached to project "acme"/);
  });

  test("re-linking a project to the repo it already has is not a conflict", async () => {
    seedRegistry([entry("acme", { path: "/src/acme", owner: "acme", repo: "web" })]);
    _setGitRunner(fakeGit({ "/src/acme": "git@github.com:acme/web.git" }));

    const repo = await resolveBindableRepo("/src/acme", { forSlug: "acme" });
    expect(repo.provider.owner).toBe("acme");
  });

  test("binds the main worktree, not a linked worktree path", async () => {
    seedRegistry([entry("acme")]);
    // `git worktree list` reports the main tree first regardless of cwd; the
    // fake keys off cwd, so this asserts we store what git reported.
    _setGitRunner(async (cwd, args) => {
      if (args[0] === "worktree") return `worktree /src/acme\nHEAD abc\n`;
      if (args[0] === "config") {
        expect(cwd).toBe("/src/acme");
        return "https://github.com/acme/web.git";
      }
      return "origin/main";
    });

    const repo = await resolveBindableRepo("/src/acme/../acme/wt-feature");
    expect(repo.path).toBe("/src/acme");
  });
});
