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
import { _setRootDir } from "@/lib/paths";

// Temp DB + temp runtime dir so adoption has somewhere to write rows and
// markers. Both overrides run at top level, before any test body.
const workdir = mkdtempSync(join(tmpdir(), "bertrand-adopt-"));
// Nothing here reads bertrand's home, but a mistake that made it start would
// otherwise scribble in the developer's real ~/.bertrand.
_setRootDir(join(workdir, "home"));
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

const { runAdopt, describeGroup } = await import("./adopt");
const { getSession, updateSession } = await import("@/db/queries/sessions");
const { shouldIgnoreStatusFlip } = await import("./update");
const { getConversation, getConversationsBySession } = await import(
  "@/db/queries/conversations"
);
const { getEventsBySession } = await import("@/db/queries/events");

let counter = 0;
/** A distinct claude session id per test — each one is adopted at most once. */
function claudeId(): string {
  return `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
}

/**
 * A real repo on a known branch. The session key is read by shelling out to
 * git, so there is no seam to fake — and `rev-parse --abbrev-ref HEAD` needs a
 * commit, since an unborn HEAD is an ambiguous argument.
 *
 * No `origin`, deliberately: `groupKey` then falls back to `path:<worktree>`,
 * which is the fallback a local repo actually gets and is enough to key a group
 * on. `workdir` itself is not a repo, so a cwd of `workdir` derives to all
 * nulls — the ungrouped case most tests here want.
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
    expect(contents).toBe(`session=${result.sessionId}\n`);
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
    expect(readAdoptionMarker(cid)).toEqual({ sessionId: first.sessionId });
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

  test("re-reads the whole key, which a resume can land somewhere else", async () => {
    const cid = claudeId();

    const first = await runAdopt({
      claudeSessionId: cid,
      cwd: workdir,
      pid: process.pid,
      backfill: false,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // Adopted outside a repo, so the whole key starts empty.
    const before = getSession(first.sessionId)!;
    expect(before.branch).toBeNull();
    expect(before.groupKey).toBeNull();

    const repo = makeRepo("resumed-repo", "elky-183-resumed");
    const second = await runAdopt({
      claudeSessionId: cid,
      cwd: repo,
      pid: process.pid,
      backfill: false,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // Carried over instead of re-read, the row would still say "no branch, no
    // group" for a session now running on a branch in a repo.
    const after = getSession(first.sessionId)!;
    expect(after.branch).toBe("elky-183-resumed");
    expect(after.worktreeRoot).not.toBeNull();
    expect(after.groupKey).toBe(`path:${after.worktreeRoot}`);
    expect(second.group.key).toBe(after.groupKey);
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

describe("runAdopt — find-or-create on the group key", () => {
  test("a second conversation on one key joins the open session", async () => {
    // The whole point of keying a session on the work: two claude runs against
    // one task used to be two sessions, which is why `session` sat 1:1 with
    // `conversation` and the sibling summaries had nothing to group.
    const repo = makeRepo("group-join", "elky-184-join");

    const first = await runAdopt({
      claudeSessionId: claudeId(),
      cwd: repo,
      pid: null,
      backfill: false,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.reattached).toBe(false);

    const secondCid = claudeId();
    const second = await runAdopt({
      claudeSessionId: secondCid,
      cwd: repo,
      pid: null,
      backfill: false,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.sessionId).toBe(first.sessionId);
    expect(second.reattached).toBe(true);
    expect(second.group.key).toBe(first.group.key);

    // One session, two conversations — not one conversation re-pointed.
    expect(getConversation(secondCid)?.sessionId).toBe(first.sessionId);
    expect(getConversationsBySession(first.sessionId)).toHaveLength(2);
  });

  test("an archived session on the key does not capture new work", async () => {
    // Archiving is the user saying "this one is done". A later claude on the
    // same branch is new work and must get a row of its own, rather than
    // reanimating the archived one or refusing outright.
    const repo = makeRepo("group-archived", "elky-184-archived");

    const first = await runAdopt({
      claudeSessionId: claudeId(),
      cwd: repo,
      pid: null,
      backfill: false,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    updateSession(first.sessionId, { status: "archived" });

    const second = await runAdopt({
      claudeSessionId: claudeId(),
      cwd: repo,
      pid: null,
      backfill: false,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.reattached).toBe(false);
    expect(second.group.key).toBe(first.group.key);
    expect(getSession(first.sessionId)!.status).toBe("archived");
  });

  test("a cwd with no key mints a session every time", async () => {
    // `workdir` is not a repo, so the key is all nulls. An unresolvable key is
    // not evidence that two conversations are the same work — grouping on it
    // would collapse every non-repo claude on the machine into one session.
    const a = await runAdopt({
      claudeSessionId: claudeId(),
      cwd: workdir,
      pid: null,
      backfill: false,
    });
    const b = await runAdopt({
      claudeSessionId: claudeId(),
      cwd: workdir,
      pid: null,
      backfill: false,
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    expect(a.group.key).toBeNull();
    expect(b.group.key).toBeNull();
    expect(b.sessionId).not.toBe(a.sessionId);
    expect(b.reattached).toBe(false);
    // Recorded regardless: bertrand logs sessions outside git and must keep
    // doing so, ungrouped.
    expect(getSession(b.sessionId)!.groupKey).toBeNull();
    expect(getSession(b.sessionId)!.repo).toBeNull();
  });

  test("persists the derived key on the row it creates", async () => {
    const repo = makeRepo("group-persist", "elky-184-persist");
    const result = await runAdopt({
      claudeSessionId: claudeId(),
      cwd: repo,
      pid: null,
      backfill: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const session = getSession(result.sessionId)!;
    // The pieces are stored alongside the key computed from them: the key
    // cannot name the worktree a session ran in, and the dashboard and
    // `--resume` both need that path without re-shelling out to git.
    expect(session.branch).toBe("elky-184-persist");
    expect(session.worktreeRoot).toEndWith("/group-persist");
    // Not compared to `worktreeRoot` textually: `--show-toplevel` answers with
    // symlinks resolved and `--git-common-dir` does not, so on macOS (where
    // /var is a symlink to /private/var) the same checkout spells differently
    // in the two columns. Both name this directory, which is what matters.
    expect(session.mainCheckout).toEndWith("/group-persist");
    expect(session.repo).toBeNull(); // no origin on a bare `git init`
    expect(session.groupKey).toBe(`path:${session.worktreeRoot}`);
  });
});

describe("describeGroup", () => {
  // The line under `Adopted this claude session as <slug>.` — it replaced
  // `project: <slug>`, which named a registry row nobody in an adopted claude
  // had chosen and was usually not the directory the session ran in.
  const key = {
    worktreeRoot: "/w/task",
    mainCheckout: "/w/main",
    branch: "feature/x",
    repo: "acme/app",
  };

  test("names the repo and branch when both resolved", () => {
    expect(describeGroup({ ...key, key: "acme/app@feature/x" }, "/w/task")).toBe(
      "  group: acme/app@feature/x",
    );
  });

  test("says why a path key is a path key", () => {
    expect(
      describeGroup(
        { ...key, repo: null, key: "path:/w/task" },
        "/w/task",
      ),
    ).toContain("path:/w/task");
  });

  test("an unresolvable cwd is reported as recorded, not as a failure", () => {
    const line = describeGroup(
      {
        worktreeRoot: null,
        mainCheckout: null,
        branch: null,
        repo: null,
        key: null,
      },
      "/tmp",
    );
    expect(line).toContain("/tmp");
    expect(line).toContain("ungrouped");
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

describe("runAdopt — status flips on a payload-keyed session", () => {
  // `update` refuses active/waiting/blocked on a row with a null pid, to stop a
  // reparented hook resurrecting a session bertrand already finalized. Every
  // row bertrand did not launch used to sit in exactly that state, which would
  // have left adopted sessions permanently stuck at whatever status they were
  // created with. Recording claude's own pid is what buys them back — so these
  // two tests pin the property the guard depends on, from both directions.
  const FLIPS = ["active", "waiting", "blocked"] as const;

  test("adopting with claude's pid lets its hooks flip status", async () => {
    const result = await runAdopt({
      claudeSessionId: claudeId(),
      cwd: workdir,
      pid: process.pid,
      backfill: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const session = getSession(result.sessionId)!;
    expect(session.pid).toBe(process.pid);
    for (const status of FLIPS) {
      expect(shouldIgnoreStatusFlip(status, session.pid)).toBe(false);
    }
  });

  test("adopting without a pid is the state that cannot flip", async () => {
    // Why `bertrand adopt` warns out loud when it can't determine the pid: the
    // session still records events, it just never changes status again.
    const result = await runAdopt({
      claudeSessionId: claudeId(),
      cwd: workdir,
      pid: null,
      backfill: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const session = getSession(result.sessionId)!;
    expect(session.pid).toBeNull();
    for (const status of FLIPS) {
      expect(shouldIgnoreStatusFlip(status, session.pid)).toBe(true);
    }
    // Pausing still works, which is what lets recovery close the row.
    expect(shouldIgnoreStatusFlip("paused", session.pid)).toBe(false);
  });
});
