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
