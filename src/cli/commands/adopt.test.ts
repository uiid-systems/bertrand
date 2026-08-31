import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { spawn } from "child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
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

const { runAdopt } = await import("./adopt");
const { getSession } = await import("@/db/queries/sessions");
const { getConversation } = await import("@/db/queries/conversations");
const { getEventsBySession } = await import("@/db/queries/events");

let counter = 0;
/** A distinct claude session id per test — each one is adopted at most once. */
function claudeId(): string {
  return `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
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
    // matters as much as the values.
    const contents = readFileSync(adoptionMarkerPath(cid), "utf8");
    expect(contents).toBe(
      `session=${result.sessionId}\nproject=${result.project}\n`,
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

  test("declines a second adoption of the same conversation", async () => {
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

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("already-adopted");
    // It reports the session that owns the conversation, so a caller can
    // carry on with it rather than treat adoption as failed.
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.message).toContain(first.slug);
  });

  test("declines on the conversation row even when the marker is gone", async () => {
    const cid = claudeId();

    const first = await runAdopt({
      claudeSessionId: cid,
      cwd: workdir,
      pid: null,
      backfill: false,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Markers get swept; the row is what makes "already adopted" durable.
    const { rmSync } = await import("fs");
    rmSync(adoptionMarkerPath(cid));

    const second = await runAdopt({
      claudeSessionId: cid,
      cwd: workdir,
      pid: null,
      backfill: false,
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("already-adopted");
  });
});
