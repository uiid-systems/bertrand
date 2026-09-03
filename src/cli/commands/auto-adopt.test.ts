import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import * as schema from "@/db/schema";
import { _setDb } from "@/db/client";
import { _setRootDir } from "@/lib/paths";
// Type-only, so they are erased and can't disturb the load ordering the
// runtime imports below depend on.
import type { GitRunner as ResolveGitRunner } from "@/lib/github/resolve";
import type { GitRunner as KeyGitRunner } from "@/lib/session-key";

// One temp DB and one temp bertrand home for the file. `_setRootDir` has to
// come before anything reads `paths`, and it is what puts `config.json` — the
// opt-in gate this command is mostly about — somewhere a test may write.
const workdir = mkdtempSync(join(tmpdir(), "bertrand-auto-adopt-"));
_setRootDir(join(workdir, "home"));
const sqlite = new Database(join(workdir, "test.db"));
sqlite.exec("PRAGMA foreign_keys = ON");
_setDb(drizzle(sqlite, { schema }));
migrate(drizzle(sqlite), {
  migrationsFolder: join(import.meta.dir, "..", "..", "db", "migrations"),
});

const { _setRuntimeDir, adoptionMarkerPath, autoCreateGatePath, readAdoptionMarker } =
  await import("@/hooks/runtime");
_setRuntimeDir(join(workdir, "run"));

const { writeConfig } = await import("@/lib/config");
const { _setGitRunner: _setResolveGitRunner, _resetRepoCache } = await import(
  "@/lib/github/resolve"
);
const { _setGitRunner: _setKeyGitRunner } = await import("@/lib/session-key");
const { runAutoAdopt } = await import("./auto-adopt");
const { getSession } = await import("@/db/queries/sessions");
const { getConversation } = await import("@/db/queries/conversations");

let counter = 0;
/** A distinct claude session id per test — each is adopted at most once. */
function claudeId(): string {
  return `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
}

const REPO_PATH = "/src/acme";
const OTHER_PATH = "/src/other";

/** origin remotes the fake git serves, keyed by checkout path. */
const REMOTES: Record<string, string> = {
  [REPO_PATH]: "acme/app",
  [OTHER_PATH]: "acme/other",
};

/** Branch each fake checkout has out. */
const BRANCHES: Record<string, string> = {
  [REPO_PATH]: "main",
  [OTHER_PATH]: "feature/elky-184",
};

/**
 * A fake `git` answering the three `rev-parse` questions `deriveSessionKey`
 * asks. A path missing from REMOTES is "not a repo", which is how the no-repo
 * gate is exercised without needing a real directory.
 */
const fakeKeyGit: KeyGitRunner = async (cwd, args) => {
  if (!(cwd in REMOTES)) throw new Error("not a git repository");
  if (args[1] === "--show-toplevel") return cwd;
  if (args[1] === "--git-common-dir") return `${cwd}/.git`;
  if (args[1] === "--abbrev-ref") return BRANCHES[cwd]!;
  throw new Error(`unexpected git ${args.join(" ")}`);
};

/**
 * A fake `git` for the separate runner behind `resolveRepoAt`, which is what
 * turns a checkout into an `owner/repo` identity.
 */
const fakeResolveGit: ResolveGitRunner = async (cwd, args) => {
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

/** Write `~/.bertrand/config.json` with automatic adoption on or off. */
function setAutoAdopt(enabled: boolean): void {
  writeConfig({ bin: "bertrand", version: 1, autoAdopt: enabled });
}

beforeEach(() => {
  setAutoAdopt(true);
  _setKeyGitRunner(fakeKeyGit);
  _setResolveGitRunner(fakeResolveGit);
  // Resolutions are TTL-cached by absolute path, so one test's answer would
  // otherwise stand in for the next test's.
  _resetRepoCache();
});

afterEach(() => {
  _setKeyGitRunner(null);
  _setResolveGitRunner(null);
  _resetRepoCache();
});

const gate = (cid: string): string | null =>
  existsSync(autoCreateGatePath(cid))
    ? readFileSync(autoCreateGatePath(cid), "utf8")
    : null;

describe("runAutoAdopt — the gates", () => {
  test("a machine that hasn't opted in is refused, and the refusal is remembered", async () => {
    setAutoAdopt(false);
    const cid = claudeId();
    const outcome = await runAutoAdopt({
      claudeSessionId: cid,
      cwd: REPO_PATH,
      pid: null,
    });

    expect(outcome).toMatchObject({ ok: false, reason: "not-opted-in" });
    expect(getConversation(cid)).toBeUndefined();
    expect(existsSync(adoptionMarkerPath(cid))).toBe(false);
    // Non-empty is the whole point: the hook's `[ -s ]` short-circuits every
    // later prompt in this conversation without spawning anything.
    expect(gate(cid)).toContain("declined=not-opted-in");
  });

  test("an absent config reads as off, so an upgrade changes nothing", async () => {
    // The asymmetry the flag exists for: opting in wrongly records work the
    // user never asked bertrand to watch, opting out wrongly costs one
    // `bertrand adopt`. So the default has to be off, including on a machine
    // whose config.json predates the flag.
    writeConfig({ bin: "bertrand", version: 1 });
    const outcome = await runAutoAdopt({
      claudeSessionId: claudeId(),
      cwd: REPO_PATH,
      pid: null,
    });
    expect(outcome).toMatchObject({ ok: false, reason: "not-opted-in" });
  });

  test("the opt-in message names both ways to record the session", async () => {
    setAutoAdopt(false);
    const outcome = await runAutoAdopt({
      claudeSessionId: claudeId(),
      cwd: REPO_PATH,
      pid: null,
    });
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.message).toContain("autoAdopt");
    expect(outcome.message).toContain("bertrand adopt");
  });

  test("a cwd that is not a repo is refused, opted in or not", async () => {
    const cid = claudeId();
    const outcome = await runAutoAdopt({
      claudeSessionId: cid,
      cwd: "/somewhere/not-a-repo",
      pid: null,
    });

    // Nothing to group a session by, and a claude in a directory like this is
    // overwhelmingly not work. `bertrand adopt` still records it on request.
    expect(outcome).toMatchObject({ ok: false, reason: "no-repo" });
    expect(getConversation(cid)).toBeUndefined();
    expect(existsSync(adoptionMarkerPath(cid))).toBe(false);
    expect(gate(cid)).toContain("declined=no-repo");
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
});

describe("runAutoAdopt — creation", () => {
  test("an opted-in repo gets an unnamed, derived session", async () => {
    const cid = claudeId();
    const outcome = await runAutoAdopt({
      claudeSessionId: cid,
      cwd: REPO_PATH,
      pid: null,
    });

    expect(outcome).toMatchObject({
      ok: true,
      created: true,
      group: "acme/app@main",
    });
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

  test("the session is filed under the cwd's repo and branch", async () => {
    const outcome = await runAutoAdopt({
      claudeSessionId: claudeId(),
      cwd: OTHER_PATH,
      pid: null,
    });
    if (!outcome.ok) throw new Error("unreachable");

    // Read from git at the cwd, which is the whole change: this used to be a
    // registry lookup that answered with the *active* project — a value
    // nothing in an auto-adopted claude ever set.
    const session = getSession(outcome.sessionId)!;
    expect(session.repo).toBe("acme/other");
    expect(session.branch).toBe("feature/elky-184");
    expect(session.groupKey).toBe("acme/other@feature/elky-184");
    expect(session.worktreeRoot).toBe(OTHER_PATH);
    expect(session.mainCheckout).toBe(OTHER_PATH);
  });

  test("the marker carries the session and nothing else", async () => {
    const cid = claudeId();
    const outcome = await runAutoAdopt({
      claudeSessionId: cid,
      cwd: REPO_PATH,
      pid: null,
    });
    if (!outcome.ok) throw new Error("unreachable");

    // It used to carry a project slug too, so a hook tick could export
    // BERTRAND_PROJECT and pick a database. There is one database now.
    expect(readAdoptionMarker(cid)).toEqual({ sessionId: outcome.sessionId });
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

  test("a second conversation in the same repo joins the open session", async () => {
    const cid = claudeId();
    const first = await runAutoAdopt({ claudeSessionId: cid, cwd: REPO_PATH, pid: null });
    if (!first.ok) throw new Error("first call should have created a session");

    const second = await runAutoAdopt({
      claudeSessionId: claudeId(),
      cwd: REPO_PATH,
      pid: null,
    });

    // Auto-adoption inherits find-or-create from `runAdopt`: repeated claude
    // runs on one task are conversations of one session, not sessions of one.
    expect(second).toMatchObject({
      ok: true,
      created: false,
      sessionId: first.sessionId,
    });
  });

  test("creation leaves the gate alone so nothing masks a live session", async () => {
    const cid = claudeId();
    // The hook wrote this empty on the first prompt.
    writeFileSync(autoCreateGatePath(cid), "");
    await runAutoAdopt({ claudeSessionId: cid, cwd: REPO_PATH, pid: null });
    expect(gate(cid)).toBe("");
  });
});
