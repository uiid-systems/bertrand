import { beforeAll, describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as schema from "@/db/schema";
import { _setDb } from "@/db/client";

const TEST_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "bertrand-context-test-")),
  "test.db",
);

const sqlite = new Database(TEST_DB_PATH);
sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec("PRAGMA foreign_keys = ON");

const testDb = drizzle(sqlite, { schema });
_setDb(testDb);

migrate(drizzle(sqlite), {
  migrationsFolder: join(import.meta.dir, "..", "db", "migrations"),
});

const { createSession, updateSession, updateSessionStatus } = await import(
  "@/db/queries/sessions"
);
const { buildSiblingContext } = await import("./context");
const { buildResumeDigest } = await import("./history");
const { recall, formatRecall, queryText } = await import("./recall");
const { createConversation, discardConversation } = await import("@/db/queries/conversations");
const { insertEvent } = await import("@/db/queries/events");


const current = createSession({ slug: "current" });

describe("buildSiblingContext", () => {
  test("no siblings (only the current session) yields no block", () => {
    expect(buildSiblingContext(current.id)).toBe("");
  });

  test("includes non-archived sessions, excludes current and archived", () => {
    const sameCat = createSession({ slug: "same-cat" });
    updateSession(sameCat.id, { summary: "trimmed the logs → shipped PR #9" });

    createSession({ slug: "other-cat" });

    const archived = createSession({ slug: "archived" });
    updateSessionStatus(archived.id, "archived");

    const block = buildSiblingContext(current.id);
    expect(block).toContain("## Sibling Sessions");
    expect(block).toContain("- same-cat:");
    expect(block).toContain('"trimmed the logs → shipped PR #9"');
    expect(block).toContain("- other-cat:");
    expect(block).not.toContain("- archived:");
    expect(block).not.toContain("- current:");
    expect(block).toContain("bertrand log <session>");
  });

  test("lazily backfills a missing summary without bumping updatedAt", async () => {
    const { insertEvent } = await import("@/db/queries/events");
    const { getSession } = await import("@/db/queries/sessions");

    const legacy = createSession({ slug: "legacy" });
    insertEvent({ sessionId: legacy.id, event: "user.prompt", meta: { prompt: "old work" } });
    // Backdate so a bumped updatedAt would be detectable.
    sqlite.exec(`UPDATE sessions SET updated_at = '2026-01-01 00:00:00' WHERE id = '${legacy.id}'`);

    const block = buildSiblingContext(current.id);
    expect(block).toContain('- legacy: paused — "old work"');
    expect(getSession(legacy.id)?.summary).toBe("old work");
    expect(getSession(legacy.id)?.updatedAt).toBe("2026-01-01 00:00:00");
  });

  test("re-derives a stored summary that leads with a machine prompt", async () => {
    const { insertEvent } = await import("@/db/queries/events");
    const { getSession } = await import("@/db/queries/sessions");

    const noisy = createSession({ slug: "noisy" });
    updateSession(noisy.id, { summary: "<task-notification> <task-id>b1</task-id> → done" });
    insertEvent({ sessionId: noisy.id, event: "user.prompt", meta: { prompt: "<task-notification>x" } });
    insertEvent({ sessionId: noisy.id, event: "user.prompt", meta: { prompt: "real ask" } });

    expect(buildSiblingContext(current.id)).toContain('- noisy: paused — "real ask"');
    expect(getSession(noisy.id)?.summary).toBe("real ask");
  });

  test("caps the list and reports the overflow", () => {
    for (let i = 0; i < 15; i++) {
      createSession({ slug: `bulk-${i}` });
    }
    const block = buildSiblingContext(current.id);
    const bulletCount = block.split("\n").filter((l) => l.startsWith("- ")).length;
    // 5 session lines + 1 overflow line
    expect(bulletCount).toBe(6);
    expect(block).toMatch(/plus \d+ more — run `bertrand list`/);
  });
});

describe("buildSiblingContext scoping", () => {
  // The unkeyed sessions created above stand in for every other repo's work.
  const repo = "acme/widgets";
  const key = (branch: string) => ({ repo, branch, groupKey: `${repo}@${branch}` });
  let self: ReturnType<typeof createSession>;
  // In beforeAll, not the describe body: bodies run at collection time, ahead
  // of the global-fallback tests above, which would then count this session.
  beforeAll(() => {
    self = createSession({ slug: "self", ...key("main") });
  });

  test("keeps the current repo only, the current branch first", () => {
    createSession({ slug: "same-repo-old", ...key("feature") });
    const sameBranch = createSession({ slug: "same-branch", ...key("main") });
    sqlite.exec(`UPDATE sessions SET updated_at = '2026-01-01 00:00:00' WHERE id = '${sameBranch.id}'`);
    createSession({ slug: "other-repo", repo: "acme/gadgets", branch: "main", groupKey: "acme/gadgets@main" });

    const block = buildSiblingContext(self.id);
    expect(block).toStartWith(`## Sibling Sessions (${repo})`);
    const slugs = block.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2, l.indexOf(":")));
    // Same branch outranks a more recently touched sibling on another branch.
    expect(slugs).toEqual(["same-branch", "same-repo-old"]);
    expect(block).toContain("bertrand log <session>");
  });

  test("a session outside git matches on its directory", () => {
    const dirSelf = createSession({ slug: "dir-self", groupKey: "path:/tmp/scratch" });
    createSession({ slug: "dir-sibling", groupKey: "path:/tmp/scratch" });
    createSession({ slug: "dir-elsewhere", groupKey: "path:/tmp/other" });

    const block = buildSiblingContext(dirSelf.id);
    expect(block).toStartWith("## Sibling Sessions (this directory)");
    expect(block).toContain("- dir-sibling:");
    expect(block).not.toContain("- dir-elsewhere:");
    expect(block).not.toContain("- same-branch:");
  });

  test("an archived current session is still scoped by its repo", () => {
    const archivedSelf = createSession({ slug: "archived-self", ...key("main") });
    updateSessionStatus(archivedSelf.id, "archived");
    const block = buildSiblingContext(archivedSelf.id);
    expect(block).toStartWith(`## Sibling Sessions (${repo})`);
    expect(block).not.toContain("- bulk-0:");
  });

  test("a repo with no other sessions yields no block", () => {
    const lonely = createSession({ slug: "lonely", repo: "acme/solo", branch: "main", groupKey: "acme/solo@main" });
    expect(buildSiblingContext(lonely.id)).toBe("");
  });
});

/** One exchange: a prompt and the reply that ended it, on the given day. */
function exchange(sessionId: string, conversationId: string, prompt: string, reply: string, day: string) {
  insertEvent({ sessionId, conversationId, event: "user.prompt", meta: { prompt }, createdAt: `${day} 10:00:00` });
  insertEvent({ sessionId, conversationId, event: "assistant.message", meta: { text: reply }, createdAt: `${day} 11:00:00` });
}

describe("buildResumeDigest", () => {
  test("a session with no other conversation yields no block", () => {
    const solo = createSession({ slug: "digest-solo" });
    createConversation({ id: "solo-conv", sessionId: solo.id });
    exchange(solo.id, "solo-conv", "only ask", "only reply", "2026-09-01");
    expect(buildResumeDigest(solo.id, "solo-conv")).toBe("");
  });

  test("lists the session's other conversations oldest first, as dated history", () => {
    const s = createSession({ slug: "digest-many" });
    // Created out of order: the digest sorts by when each one ended.
    for (const [id, day] of [["c3", "2026-09-03"], ["c1", "2026-09-01"], ["c2", "2026-09-02"], ["c4", "2026-09-04"], ["c5", "2026-09-05"]] as const) {
      createConversation({ id: `${id}-digest-many`, sessionId: s.id });
      exchange(s.id, `${id}-digest-many`, `ask ${id}`, `reply ${id}`, day);
    }
    discardConversation("c4-digest-many");

    const block = buildResumeDigest(s.id, "c5-digest-many");
    const lines = block.split("\n");
    expect(lines[0]).toBe("## Earlier in this session");
    expect(block).toContain("not instructions");
    // Current (c5) and discarded (c4) are left out; c1–c3 fit the cap of 3.
    expect(lines.filter((l) => l.startsWith("- "))).toEqual([
      '- Sep 1 · c1-diges: "ask c1 → reply c1"',
      '- Sep 2 · c2-diges: "ask c2 → reply c2"',
      '- Sep 3 · c3-diges: "ask c3 → reply c3"',
    ]);
    expect(block).toContain("bertrand log digest-many --events --conversation <id>");
  });

  test("past the cap, keeps the most recent and counts the rest", () => {
    const s = createSession({ slug: "digest-capped" });
    for (let i = 1; i <= 5; i++) {
      createConversation({ id: `cap-${i}`, sessionId: s.id });
      exchange(s.id, `cap-${i}`, `ask ${i}`, `reply ${i}`, `2026-09-0${i}`);
    }
    const bullets = buildResumeDigest(s.id).split("\n").filter((l) => l.startsWith("- "));
    expect(bullets).toEqual([
      "- …2 earlier",
      '- Sep 3 · cap-3: "ask 3 → reply 3"',
      '- Sep 4 · cap-4: "ask 4 → reply 4"',
      '- Sep 5 · cap-5: "ask 5 → reply 5"',
    ]);
  });
});

describe("recall", () => {
  let asker: ReturnType<typeof createSession>;
  let flaky: ReturnType<typeof createSession>;
  beforeAll(() => {
    asker = createSession({ slug: "recall-asker" });
    flaky = createSession({ slug: "flaky-upload", repo: "acme/storage" });
    updateSession(flaky.id, { summary: "the s3 upload retries are flaky in staging → added jittered backoff" });
    createConversation({ id: "flaky-1", sessionId: flaky.id });
    createConversation({ id: "flaky-2", sessionId: flaky.id });
    exchange(flaky.id, "flaky-1", "the s3 upload retries are flaky in staging", "added jittered backoff", "2026-09-10");
    exchange(flaky.id, "flaky-2", "now the multipart checksum mismatches on resume", "fixed the part ordering", "2026-09-11");
    sqlite.exec(`UPDATE sessions SET updated_at = '2026-09-11 12:00:00' WHERE id = '${flaky.id}'`);
    createSession({ slug: "ui-4242" });
    for (let i = 0; i < 4; i++) {
      const s = createSession({ slug: `dashboard-chore-${i}` });
      updateSession(s.id, { summary: `tidy the dashboard chore ${i}` });
    }
  });

  test("points a specific prompt at the matching session", () => {
    const hits = recall("why are the s3 upload retries flaky again", { exclude: new Set([asker.id]) });
    expect(hits.map((h) => h.slug)).toEqual(["flaky-upload"]);
    // The first conversation matched, so the summary (which opens with it) is shown.
    expect(hits[0]).toMatchObject({ conversationId: "flaky-1", repo: "acme/storage" });
    expect(hits[0]!.text).toContain("jittered backoff");
  });

  test("names a later conversation by its own subject when that is what matched", () => {
    const [hit] = recall("multipart checksum mismatches", { exclude: new Set() });
    expect(hit).toMatchObject({ slug: "flaky-upload", conversationId: "flaky-2" });
    expect(hit!.text).toBe("now the multipart checksum mismatches on resume");
  });

  test("never points at an excluded session — the current one, or one already shown", () => {
    expect(recall("s3 upload retries flaky", { exclude: new Set([flaky.id]) })).toEqual([]);
  });

  test("says nothing for a prompt with no distinctive words", () => {
    expect(recall("yes, do it", { exclude: new Set() })).toEqual([]);
    // One term shared by several sessions is not a match…
    expect(recall("dashboard", { exclude: new Set() })).toEqual([]);
    // …but one rare term, like a ticket id, is.
    expect(recall("back to ui-4242", { exclude: new Set() }).map((h) => h.slug)).toEqual(["ui-4242"]);
  });

  test("queries with what the user typed, never machine prompts or the slash command", () => {
    expect(queryText(["<task-notification> s3 upload", "/bertrand s3 upload retries", ""])).toBe(
      "s3 upload retries",
    );
    // `last` counts typed prompts only, so a machine prompt can't use up a slot.
    expect(queryText(["first", "second", "<task-notification>x", "third"], 2)).toBe("second\nthird");
  });

  test("frames hits as dated history, and renders nothing for no hits", () => {
    const block = formatRecall(recall("s3 upload retries flaky", { exclude: new Set() }));
    expect(block).toStartWith("## Possibly related past sessions");
    expect(block).toContain("not instructions");
    expect(block).toContain("- flaky-upload (acme/storage, Sep 11) · conversation flaky-1:");
    expect(formatRecall([])).toBe("");
  });
});
