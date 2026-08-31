import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import * as schema from "@/db/schema";
import { _setDb } from "@/db/client";
// Type-only, so it is erased and can't disturb the load ordering the runtime
// imports below depend on.
import type { GitRunner } from "@/lib/github/resolve";

// One temp DB for the file, as in adopt.test.ts: `_setDb` overrides `getDb()`
// and `getDbForProject()` alike, so project routing is asserted through the
// marker and the returned slug rather than through which file was written.
const workdir = mkdtempSync(join(tmpdir(), "bertrand-auto-adopt-"));
const sqlite = new Database(join(workdir, "test.db"));
sqlite.exec("PRAGMA foreign_keys = ON");
_setDb(drizzle(sqlite, { schema }));
migrate(drizzle(sqlite), {
  migrationsFolder: join(import.meta.dir, "..", "..", "db", "migrations"),
});

const { _setRuntimeDir, adoptionMarkerPath, autoCreateGatePath, readAdoptionMarker } =
  await import("@/hooks/runtime");
_setRuntimeDir(join(workdir, "run"));

const { _setRegistryDir, writeRegistry } = await import("@/lib/projects/registry");
const { _resetActiveProjectCache } = await import("@/lib/projects/resolve");
const { _setGitRunner, _resetRepoCache } = await import("@/lib/github/resolve");
const { runAutoAdopt } = await import("./auto-adopt");
const { getSession } = await import("@/db/queries/sessions");
const { getConversation } = await import("@/db/queries/conversations");

_setRegistryDir(join(workdir, "registry"));

let counter = 0;
/** A distinct claude session id per test — each is adopted at most once. */
function claudeId(): string {
  return `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
}

const REPO_PATH = "/src/acme";
const OTHER_PATH = "/src/other";
/** A real repo whose origin no project is bound to. */
const LOOSE_PATH = "/src/loose";

/** origin remotes the fake git serves, keyed by main-worktree path. */
const REMOTES: Record<string, string> = {
  [REPO_PATH]: "acme/app",
  [OTHER_PATH]: "acme/other",
  [LOOSE_PATH]: "acme/loose",
};

/**
 * A fake `git` answering the three questions `resolveRepoAt` asks. Keys are
 * main-worktree paths; a missing key is "not a repo". Mirrors the helper in
 * project.test.ts — the shape `resolveRepoAt` drives is the same either way.
 */
const fakeGit: GitRunner = async (cwd, args) => {
  if (args[0] === "worktree") {
    if (!(cwd in REMOTES)) throw new Error("not a git repository");
    return `worktree ${cwd}\nHEAD abc123\n`;
  }
  if (args[0] === "config") {
    const slug = REMOTES[cwd];
    if (!slug) throw new Error("key does not exist");
    return `git@github.com:${slug}.git`;
  }
  if (args[0] === "symbolic-ref") return "origin/main";
  throw new Error(`unexpected git ${args.join(" ")}`);
};

/**
 * Registry with `acme` opted in, `other` bound but opted out, and `dormant`
 * active — so every test runs with the *wrong* project active, which is the
 * failure this command's `useProject` call exists to prevent.
 */
function seedRegistry(): void {
  const now = new Date().toISOString();
  const entry = (slug: string, path: string | null, autoAdopt?: boolean) => ({
    slug,
    name: slug,
    createdAt: now,
    lastUsedAt: now,
    // Identity comes from the remote, not the directory name — matching by
    // origin is the whole point of `resolveProjectForCwd`.
    ...(path
      ? {
          repo: {
            path,
            provider: {
              provider: "github" as const,
              owner: REMOTES[path]!.split("/")[0]!,
              repo: REMOTES[path]!.split("/")[1]!,
            },
          },
        }
      : {}),
    ...(autoAdopt ? { autoAdopt: true } : {}),
  });
  writeRegistry({
    activeProjectSlug: "dormant",
    projects: [
      entry("dormant", null),
      entry("acme", REPO_PATH, true),
      entry("other", OTHER_PATH),
    ],
  });
  _resetActiveProjectCache();
}

beforeEach(() => {
  seedRegistry();
  _setGitRunner(fakeGit);
  // Resolutions are TTL-cached by absolute path, so one test's answer would
  // otherwise stand in for the next test's registry.
  _resetRepoCache();
});

afterEach(() => {
  _setGitRunner(null);
  _resetRepoCache();
  delete process.env.BERTRAND_PROJECT;
  _resetActiveProjectCache();
});

const gate = (cid: string): string | null =>
  existsSync(autoCreateGatePath(cid))
    ? readFileSync(autoCreateGatePath(cid), "utf8")
    : null;

describe("runAutoAdopt — the gates", () => {
  test("a cwd no project owns is refused, and the refusal is remembered", async () => {
    const cid = claudeId();
    const outcome = await runAutoAdopt({
      claudeSessionId: cid,
      cwd: "/somewhere/unregistered",
      pid: null,
    });

    expect(outcome).toMatchObject({ ok: false, reason: "no-project" });
    expect(getConversation(cid)).toBeUndefined();
    expect(existsSync(adoptionMarkerPath(cid))).toBe(false);
    // Non-empty is the whole point: the hook's `[ -s ]` short-circuits every
    // later prompt in this conversation without spawning anything.
    expect(gate(cid)).toContain("declined=no-project");
  });

  test("a bound project that hasn't opted in is refused, and says how to opt in", async () => {
    const cid = claudeId();
    const outcome = await runAutoAdopt({
      claudeSessionId: cid,
      cwd: OTHER_PATH,
      pid: null,
    });

    expect(outcome).toMatchObject({ ok: false, reason: "not-opted-in" });
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.message).toContain("bertrand project auto other on");
    expect(getConversation(cid)).toBeUndefined();
    expect(gate(cid)).toContain("declined=not-opted-in");
  });

  test("a claude bertrand launched is refused rather than duplicated", async () => {
    const cid = claudeId();
    const outcome = await runAutoAdopt({
      claudeSessionId: cid,
      cwd: REPO_PATH,
      pid: null,
      launchedSessionId: "already-tracked",
    });

    expect(outcome).toMatchObject({ ok: false, reason: "already-launched" });
    expect(getConversation(cid)).toBeUndefined();
  });

  test("a git repo whose origin no project owns is refused", async () => {
    const cid = claudeId();
    // Distinct from the case above: this cwd resolves to a GitHub identity
    // cleanly, there is just no project bound to it. Auto-creation must not
    // invent one — projects are bound to repos by a human (UnboundProjectError).
    const outcome = await runAutoAdopt({
      claudeSessionId: cid,
      cwd: LOOSE_PATH,
      pid: null,
    });
    expect(outcome).toMatchObject({ ok: false, reason: "no-project" });
  });
});

describe("runAutoAdopt — creation", () => {
  test("an opted-in project gets an unnamed, derived session", async () => {
    const cid = claudeId();
    const outcome = await runAutoAdopt({
      claudeSessionId: cid,
      cwd: REPO_PATH,
      pid: null,
    });

    expect(outcome).toMatchObject({ ok: true, created: true, project: "acme" });
    if (!outcome.ok) throw new Error("unreachable");

    const session = getSession(outcome.sessionId)!;
    // Never a prompt, and never a name of its own: ELKY-172 derivation names
    // it at the first pause, and `createSession` throws if a derived row
    // arrives carrying one.
    expect(session.nameSource).toBe("derived");
    expect(session.name).toBe(session.slug);

    // The conversation is keyed on claude's own session id — the invariant
    // every hook, the transcript lookup and the contract marker depend on.
    expect(getConversation(cid)?.sessionId).toBe(outcome.sessionId);
  });

  test("the session lands in the cwd's project, not the active one", async () => {
    const cid = claudeId();
    const outcome = await runAutoAdopt({
      claudeSessionId: cid,
      cwd: REPO_PATH,
      pid: null,
    });

    expect(outcome).toMatchObject({ ok: true, project: "acme" });
    // The marker is how the hooks learn which project to write into; the
    // active project is still `dormant`, and without this they'd use it.
    expect(readAdoptionMarker(cid)?.project).toBe("acme");
  });

  test("a second call re-attaches instead of creating a second session", async () => {
    const cid = claudeId();
    const first = await runAutoAdopt({ claudeSessionId: cid, cwd: REPO_PATH, pid: null });
    if (!first.ok) throw new Error("first call should have created a session");

    // What a `claude --resume` looks like once the session was finalized and
    // its marker pruned: rows present, marker gone.
    writeFileSync(adoptionMarkerPath(cid), "");
    const second = await runAutoAdopt({ claudeSessionId: cid, cwd: REPO_PATH, pid: null });

    expect(second).toMatchObject({
      ok: true,
      created: false,
      sessionId: first.sessionId,
    });
    // The marker is rewritten, which is what makes the hooks start resolving
    // the session again.
    expect(readAdoptionMarker(cid)?.sessionId).toBe(first.sessionId);
  });

  test("creation leaves the gate alone so nothing masks a live session", async () => {
    const cid = claudeId();
    // The hook wrote this empty on the first prompt.
    writeFileSync(autoCreateGatePath(cid), "");
    await runAutoAdopt({ claudeSessionId: cid, cwd: REPO_PATH, pid: null });
    expect(gate(cid)).toBe("");
  });
});
