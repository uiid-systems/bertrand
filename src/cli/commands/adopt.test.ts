import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { execFileSync, spawn } from "child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";

import * as schema from "@/db/schema";
import { _setDb } from "@/db/client";

// Temp DB + temp runtime dir so adoption has somewhere to write rows and
// markers. Both overrides run at top level, before any test body.
const workdir = mkdtempSync(join(tmpdir(), "bertrand-adopt-"));
const sqlite = new Database(join(workdir, "test.db"));
sqlite.exec("PRAGMA foreign_keys = ON");
_setDb(drizzle(sqlite, { schema }));
migrate(drizzle(sqlite), {
  migrationsFolder: join(import.meta.dir, "..", "..", "db", "migrations"),
});

const { _setRuntimeDir, adoptionMarkerPath, readAdoptionMarker } = await import(
  "@/hooks/runtime"
);
_setRuntimeDir(join(workdir, "run"));

// No registry file, so `listProjects()` is empty — a fresh install, and what
// CI runs as. Re-attachment has to work off the active project alone here; a
// scan of registered projects finds nothing to attach to.
const { _setRegistryDir } = await import("@/lib/projects/registry");
_setRegistryDir(join(workdir, "registry"));

const { runAdopt } = await import("./adopt");
const { getSession, updateSession } = await import("@/db/queries/sessions");
const { getConversation } = await import("@/db/queries/conversations");
const { getEventsBySession } = await import("@/db/queries/events");

let counter = 0;
/** A distinct claude session id per test — each one is adopted at most once. */
function claudeId(): string {
  return `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
}

/**
 * A real repo on a known branch. The branch column is read by shelling out to
 * git, so there is no seam to fake — and `rev-parse --abbrev-ref HEAD` needs a
 * commit, since an unborn HEAD is an ambiguous argument.
 */
function makeRepo(name: string, branch: string): string {
  const dir = join(workdir, name);
  mkdirSync(dir, { recursive: true });
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
  git("init", "-q", "-b", branch);
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  git("commit", "-q", "--allow-empty", "-m", "init");
  return dir;
}

/**
 * A minimal transcript: one assistant entry with text, which is what
 * ingestTranscript emits events for.
 */
function writeTranscript(path: string, sessionId: string, texts: string[]) {
  const lines = texts.map((text, i) =>
    JSON.stringify({
      type: "assistant",
      uuid: `${sessionId}-${i}`,
      sessionId,
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      message: {
        model: "claude-opus-5",
        content: [{ type: "text", text }],
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    }),
  );
  writeFileSync(path, `${lines.join("\n")}\n`);
}

describe("runAdopt — success path", () => {
  test("builds the session, conversation, marker, and start event", async () => {
    const cid = claudeId();

    const result = await runAdopt({
      claudeSessionId: cid,
      cwd: workdir,
      pid: process.pid,
      backfill: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const session = getSession(result.sessionId);
    expect(session).toBeDefined();
    expect(session!.slug).toBe(result.slug);
    expect(session!.status).toBe("active");
    expect(session!.pid).toBe(process.pid);

    // The conversation is keyed by claude's id — that identity is the whole
    // mechanism, since the hooks only ever see that value.
    const conversation = getConversation(cid);
    expect(conversation?.sessionId).toBe(result.sessionId);

    expect(existsSync(adoptionMarkerPath(cid))).toBe(true);
    expect(readAdoptionMarker(cid)).toEqual({
      sessionId: result.sessionId,
      project: result.project,
      pid: process.pid,
    });

    const events = getEventsBySession(result.sessionId);
    expect(events.some((e) => e.event === "claude.started")).toBe(true);
  });

  test("creates the session unnamed and derived, for pause-time naming", async () => {
    const result = await runAdopt({
      claudeSessionId: claudeId(),
      cwd: workdir,
      pid: null,
      backfill: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const session = getSession(result.sessionId)!;
    // 'derived' is what lets summary.ts rename it at the first pause; a
    // display name of its own would be silently replaced there.
    expect(session.nameSource).toBe("derived");
    expect(session.name).toBe(session.slug);
  });

  test("records the marker in a shell-readable key=value form", async () => {
    const cid = claudeId();
    const result = await runAdopt({
      claudeSessionId: cid,
      cwd: workdir,
      pid: null,
      backfill: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The hook guards parse this with grep and cut, never jq — so the shape
    // matters as much as the values. `pid` is omitted here rather than written
    // empty: the stale sweep reads it to tell a running claude from a dead one.
    const contents = readFileSync(adoptionMarkerPath(cid), "utf8");
    expect(contents).toBe(
      `session=${result.sessionId}\nproject=${result.project}\n`,
    );
  });

  test("records claude's pid in the marker when it is known", async () => {
    const cid = claudeId();
    const result = await runAdopt({
      claudeSessionId: cid,
      cwd: workdir,
      pid: process.pid,
      backfill: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Read by pruneStaleMarkers, which must never sweep the marker of a
    // claude that is still running.
    expect(readFileSync(adoptionMarkerPath(cid), "utf8")).toContain(
      `pid=${process.pid}\n`,
    );
  });
});

describe("runAdopt — pid identity", () => {
  test("derives pidStartedAt from the process's age, not from now", async () => {
    // Date.now() would be off by the process's whole age here, which is the
    // bug this guards: verifyPidIdentity tolerates 120s of drift, so an older
    // claude gets reaped as stale once isFreshClaim's 60s mask lapses.
    const child = spawn("sleep", ["30"], { stdio: "ignore" });
    try {
      await new Promise((r) => setTimeout(r, 2_300));

      const result = await runAdopt({
        claudeSessionId: claudeId(),
        cwd: workdir,
        pid: child.pid!,
        backfill: false,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.pidStartedAt).not.toBeNull();
      expect(Date.now() - result.pidStartedAt!).toBeGreaterThanOrEqual(1_000);
    } finally {
      child.kill();
    }
  });

  test("stores a null pidStartedAt for a pid that is already gone", async () => {
    const child = spawn("true", [], { stdio: "ignore" });
    const deadPid = child.pid!;
    await new Promise((r) => child.on("exit", r));

    const result = await runAdopt({
      claudeSessionId: claudeId(),
      cwd: workdir,
      pid: deadPid,
      backfill: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A timestamp known to be wrong is worse than none: null degrades
    // identity to a bare liveness probe instead of asserting a false start.
    expect(result.pidStartedAt).toBeNull();
  });
});

describe("runAdopt — back-fill", () => {
  test("imports the conversation so far by default", async () => {
    const cid = claudeId();
    const transcriptPath = join(workdir, `${cid}.jsonl`);
    writeTranscript(transcriptPath, cid, ["first turn", "second turn"]);

    const result = await runAdopt({
      claudeSessionId: cid,
      cwd: workdir,
      pid: null,
      transcriptPath,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backfilledEvents).toBe(2);

    const messages = getEventsBySession(result.sessionId).filter(
      (e) => e.event === "assistant.message",
    );
    expect(messages).toHaveLength(2);
  });

  test("skips the import under --no-backfill", async () => {
    const cid = claudeId();
    const transcriptPath = join(workdir, `${cid}.jsonl`);
    writeTranscript(transcriptPath, cid, ["a turn nobody asked for"]);

    const result = await runAdopt({
      claudeSessionId: cid,
      cwd: workdir,
      pid: null,
      transcriptPath,
      backfill: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backfilledEvents).toBe(0);
    expect(
      getEventsBySession(result.sessionId).filter(
        (e) => e.event === "assistant.message",
      ),
    ).toHaveLength(0);
  });

  test("adopts a conversation whose transcript does not exist yet", async () => {
    const result = await runAdopt({
      claudeSessionId: claudeId(),
      cwd: join(workdir, "nowhere"),
      pid: null,
    });

    // A missing transcript is an ordinary state (a session adopted on its
    // first turn), not a reason to refuse the adoption.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backfilledEvents).toBe(0);
  });
});

describe("runAdopt — re-attachment", () => {
  test("finds the owning session with no project registry at all", async () => {
    // A machine that has never run `bertrand project create` has an empty
    // registry, so scanning registered projects finds nothing: the active
    // project has to be consulted directly or an existing conversation reads
    // as new and gets a second session built around it.
    const { listProjects } = await import("@/lib/projects/registry");
    expect(listProjects()).toEqual([]);

    const cid = claudeId();
    const first = await runAdopt({
      claudeSessionId: cid,
      cwd: workdir,
      pid: null,
      backfill: false,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await runAdopt({
      claudeSessionId: cid,
      cwd: workdir,
      pid: null,
      backfill: false,
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.reattached).toBe(true);
    expect(second.sessionId).toBe(first.sessionId);
  });

  test("returns the existing session instead of building a second one", async () => {
    const cid = claudeId();

    const first = await runAdopt({
      claudeSessionId: cid,
      cwd: workdir,
      pid: null,
      backfill: false,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await runAdopt({
      claudeSessionId: cid,
      cwd: workdir,
      pid: null,
      backfill: false,
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // Two sessions around one conversation would split its timeline in two.
    expect(second.reattached).toBe(true);
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.slug).toBe(first.slug);
  });

  test("restores a marker that was pruned when the session was finalized", async () => {
    const cid = claudeId();

    const first = await runAdopt({
      claudeSessionId: cid,
      cwd: workdir,
      pid: null,
      backfill: false,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // What finalize does to an adopted session, and therefore the state a
    // `claude --resume` of this conversation comes back to.
    const { rmSync } = await import("fs");
    rmSync(adoptionMarkerPath(cid));

    const second = await runAdopt({
      claudeSessionId: cid,
      cwd: workdir,
      pid: null,
      backfill: false,
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // Without this the hooks have nothing to resolve and the resumed session
    // records nothing, while `adopt` reports it as already recorded.
    expect(readAdoptionMarker(cid)).toEqual({
      sessionId: first.sessionId,
      project: second.project,
    });
  });

  test("clears endedAt so a resumed session does not read as finished", async () => {
    const cid = claudeId();

    const first = await runAdopt({
      claudeSessionId: cid,
      cwd: workdir,
      pid: process.pid,
      backfill: false,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    updateSession(first.sessionId, {
      status: "paused",
      endedAt: new Date().toISOString(),
    });

    await runAdopt({
      claudeSessionId: cid,
      cwd: workdir,
      pid: process.pid,
      backfill: false,
    });

    const session = getSession(first.sessionId)!;
    expect(session.endedAt).toBeNull();
    expect(session.status).toBe("active");
  });

  test("leaves a closed session closed when claude's pid is unknown", async () => {
    const cid = claudeId();

    const first = await runAdopt({
      claudeSessionId: cid,
      cwd: workdir,
      pid: null,
      backfill: false,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const endedAt = new Date().toISOString();
    updateSession(first.sessionId, { status: "paused", endedAt });

    const second = await runAdopt({
      claudeSessionId: cid,
      cwd: workdir,
      pid: null,
      backfill: false,
    });
    expect(second.ok).toBe(true);

    // Recovery only considers rows with a pid, so re-opening this one would
    // strand it `active` with an empty endedAt forever — a correctly closed
    // record traded for one that never closes.
    const session = getSession(first.sessionId)!;
    expect(session.endedAt).toBe(endedAt);
    expect(session.status).toBe("paused");
    // The marker is still rewritten: the hooks can resolve and record, they
    // just can't flip status on a null pid.
    expect(readAdoptionMarker(cid)?.sessionId).toBe(first.sessionId);
  });

  test("re-reads the branch, which a resume can land on a different one", async () => {
    const cid = claudeId();

    const first = await runAdopt({
      claudeSessionId: cid,
      cwd: workdir,
      pid: process.pid,
      backfill: false,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // Adopted outside a repo, so the column starts empty.
    expect(getSession(first.sessionId)!.branch).toBeNull();

    const repo = makeRepo("resumed-repo", "elky-183-resumed");
    await runAdopt({
      claudeSessionId: cid,
      cwd: repo,
      pid: process.pid,
      backfill: false,
    });

    // Carried over instead of re-read, the column would still say "no branch"
    // for a session now running on one.
    expect(getSession(first.sessionId)!.branch).toBe("elky-183-resumed");
  });

  test("refuses to reanimate an archived session", async () => {
    const cid = claudeId();

    const first = await runAdopt({
      claudeSessionId: cid,
      cwd: workdir,
      pid: null,
      backfill: false,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    updateSession(first.sessionId, { status: "archived" });

    const second = await runAdopt({
      claudeSessionId: cid,
      cwd: workdir,
      pid: null,
      backfill: false,
    });

    // Archiving is the user saying "this one is done"; resuming an old
    // conversation must not quietly undo it.
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("archived");
    expect(getSession(first.sessionId)!.status).toBe("archived");
  });
});

describe("runAdopt — refusals", () => {
  test("declines a claude that bertrand launched", async () => {
    const cid = claudeId();

    const result = await runAdopt({
      claudeSessionId: cid,
      cwd: workdir,
      pid: null,
      launchedSessionId: "sess_already_live",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("already-launched");
    expect(result.sessionId).toBe("sess_already_live");

    // Nothing written — the refusal is a guard, not a partial adoption.
    expect(getConversation(cid)).toBeUndefined();
    expect(existsSync(adoptionMarkerPath(cid))).toBe(false);
  });

});
