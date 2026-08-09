import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  _setRegistryDir,
  _getRegistryDir,
  registerProject,
  setProjectRepo,
} from "@/lib/projects/registry";
import { _resetActiveProjectCache } from "@/lib/projects/resolve";
import { invalidateDbCache } from "@/db/client";
import type { ProjectSummary, ActiveProjectMeta } from "@/types";
import { startServer } from "./index";

let tmpRoot: string;
let server: ReturnType<typeof startServer>;
const originalDir = _getRegistryDir();
const originalWorkspace = process.env.BERTRAND_WORKSPACE;

/**
 * The registry dir also backs `projectPaths`, so pointing it at a temp root
 * redirects the project databases too — nothing here touches `~/.bertrand`.
 */
beforeEach(() => {
  // startServer's boot sweeps (reapOrphanedWorkspaceState /
  // recoverStaleSessionRows) are global and would run against the real machine
  // state of whoever runs `bun test`. They're gated on BERTRAND_WORKSPACE, so a
  // test that boots the server has to set it or it reaps live previews.
  process.env.BERTRAND_WORKSPACE = "1";
  delete process.env.BERTRAND_PROJECT;

  tmpRoot = mkdtempSync(join(tmpdir(), "bertrand-projects-api-"));
  _setRegistryDir(tmpRoot);
  // Both caches key off the old root; a stale entry would serve the previous
  // test's project (or the developer's real one).
  _resetActiveProjectCache();
  invalidateDbCache();

  registerProject({ slug: "bound", name: "Bound Project" });
  setProjectRepo("bound", {
    path: join(tmpRoot, "checkouts", "bertrand"),
    provider: { provider: "github", owner: "uiid-systems", repo: "bertrand" },
    defaultBranch: "main",
  });

  registerProject({ slug: "ghes", name: "Enterprise Project" });
  setProjectRepo("ghes", {
    path: join(tmpRoot, "checkouts", "internal"),
    provider: {
      provider: "github",
      owner: "acme",
      repo: "internal",
      host: "git.acme.corp",
    },
  });

  registerProject({ slug: "loose", name: "Unbound Project" });

  // Port 0 leases an ephemeral port, so a busy 5200 (or a parallel run) can't
  // flake the suite.
  server = startServer(0);
});

afterEach(() => {
  server.stop(true);
  _setRegistryDir(originalDir);
  _resetActiveProjectCache();
  invalidateDbCache();
  rmSync(tmpRoot, { recursive: true, force: true });

  if (originalWorkspace === undefined) {
    delete process.env.BERTRAND_WORKSPACE;
  } else {
    process.env.BERTRAND_WORKSPACE = originalWorkspace;
  }
});

const get = async <T>(path: string): Promise<T> => {
  const res = await fetch(`http://127.0.0.1:${server.port}${path}`);
  expect(res.status).toBe(200);
  return (await res.json()) as T;
};

const bySlug = (rows: ProjectSummary[], slug: string): ProjectSummary => {
  const row = rows.find((p) => p.slug === slug);
  if (!row) throw new Error(`No project "${slug}" in response`);
  return row;
};

describe("GET /api/projects", () => {
  test("serves the binding's identity and checkout path", async () => {
    const row = bySlug(await get<ProjectSummary[]>("/api/projects"), "bound");

    expect(row.repo).toMatchObject({
      path: join(tmpRoot, "checkouts", "bertrand"),
      provider: { provider: "github", owner: "uiid-systems", repo: "bertrand" },
      defaultBranch: "main",
    });
  });

  test("labels a github.com repo as owner/repo", async () => {
    const row = bySlug(await get<ProjectSummary[]>("/api/projects"), "bound");

    expect(row.repo?.label).toBe("uiid-systems/bertrand");
  });

  test("prefixes the host on a GitHub Enterprise binding", async () => {
    // The reason the label is built server-side: the dashboard can't import
    // formatIdentity, and hand-rolling `owner/repo` would drop the host here.
    const row = bySlug(await get<ProjectSummary[]>("/api/projects"), "ghes");

    expect(row.repo?.label).toBe("git.acme.corp/acme/internal");
  });

  test("trusts github.com without any configuration", async () => {
    const row = bySlug(await get<ProjectSummary[]>("/api/projects"), "bound");

    expect(row.repo?.hostTrusted).toBe(true);
  });

  // A binding stored before enterprise hosts had to be declared. It is still
  // served — dropping it would hide a project's repo without saying so — but
  // the dashboard needs to know not to render it as verified GitHub.
  test("marks a binding whose host is not declared", async () => {
    const row = bySlug(await get<ProjectSummary[]>("/api/projects"), "ghes");

    expect(row.repo?.hostTrusted).toBe(false);
    expect(row.repo?.label).toBe("git.acme.corp/acme/internal");
  });

  test("trusts an enterprise host once config declares it", async () => {
    writeFileSync(
      join(tmpRoot, "config.json"),
      JSON.stringify({ github: { enterpriseHosts: ["git.acme.corp"] } }),
    );

    const row = bySlug(await get<ProjectSummary[]>("/api/projects"), "ghes");

    expect(row.repo?.hostTrusted).toBe(true);
  });

  test("sends repo: null for an unbound project rather than omitting it", async () => {
    const rows = await get<ProjectSummary[]>("/api/projects");
    const row = bySlug(rows, "loose");

    // The key has to survive JSON: an absent `repo` is indistinguishable from a
    // server too old to send one, and the dashboard renders those differently.
    expect(row.repo).toBeNull();
    expect("repo" in row).toBe(true);
  });
});

describe("GET /api/active-project", () => {
  test("includes the active project's binding", async () => {
    process.env.BERTRAND_PROJECT = "bound";
    _resetActiveProjectCache();

    const active = await get<ActiveProjectMeta>("/api/active-project");

    expect(active.slug).toBe("bound");
    expect(active.repo?.label).toBe("uiid-systems/bertrand");
  });

  test("reports null when the active project is unbound", async () => {
    process.env.BERTRAND_PROJECT = "loose";
    _resetActiveProjectCache();

    const active = await get<ActiveProjectMeta>("/api/active-project");

    expect(active.slug).toBe("loose");
    expect(active.repo).toBeNull();
  });

  test("picks up a binding made after the server booted", async () => {
    process.env.BERTRAND_PROJECT = "loose";
    _resetActiveProjectCache();
    expect((await get<ActiveProjectMeta>("/api/active-project")).repo).toBeNull();

    setProjectRepo("loose", {
      path: join(tmpRoot, "checkouts", "loose"),
      provider: { provider: "github", owner: "uiid-systems", repo: "loose" },
    });

    // resolveActiveProject memoizes for the whole process lifetime, so reading
    // the binding off it would pin the answer to boot time and `project link`
    // would need a server restart to show up.
    const active = await get<ActiveProjectMeta>("/api/active-project");
    expect(active.repo?.label).toBe("uiid-systems/loose");
  });
});
