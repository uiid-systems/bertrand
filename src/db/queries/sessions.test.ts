import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as schema from "@/db/schema";
import { _setDb } from "@/db/client";

const TEST_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "bertrand-sessions-test-")),
  "test.db",
);

const sqlite = new Database(TEST_DB_PATH);
sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec("PRAGMA foreign_keys = ON");

const testDb = drizzle(sqlite, { schema });
_setDb(testDb);

migrate(drizzle(sqlite), {
  migrationsFolder: join(import.meta.dir, "..", "migrations"),
});

const {
  createSession,
  resolveSessionByName,
  isNameTakenByOtherSession,
  findOpenSessionByGroupKey,
  purgeSessionsBefore,
  updateSessionStatus,
  updateSession,
  getSession,
} = await import("@/db/queries/sessions");
const { recordSessionAlias } = await import("@/db/queries/session-aliases");
const { insertEvent, getEventsBySession } = await import("@/db/queries/events");
const { createConversation, getConversation } = await import(
  "@/db/queries/conversations"
);
const { getSessionStats } = await import("@/db/queries/stats");

// A slash-bearing slug — legal, and one identity despite the slashes.
const slashy = createSession({ slug: "REV-367/clean-up-ui" });
// A plain slug.
const plain = createSession({ slug: "get-table-screenshot" });
// A session flattened out of a pre-ELKY-171 nested category: its old
// "<category-path>/<slug>" name survives only as a migration-written alias.
const flattened = createSession({ slug: "fe-determination" });
recordSessionAlias("ssp/REV-367/fe-determination", flattened.id);

describe("resolveSessionByName", () => {
  test("resolves a plain slug", () => {
    const r = resolveSessionByName("get-table-screenshot");
    expect(r?.session.id).toBe(plain.id);
    expect(r?.slug).toBe("get-table-screenshot");
  });

  test("resolves a slash-bearing slug", () => {
    const r = resolveSessionByName("REV-367/clean-up-ui");
    expect(r?.session.id).toBe(slashy.id);
    expect(r?.slug).toBe("REV-367/clean-up-ui");
  });

  test("normalizes surrounding slashes and whitespace", () => {
    const r = resolveSessionByName("  /get-table-screenshot/  ");
    expect(r?.session.id).toBe(plain.id);
  });

  test("returns undefined for an unknown session", () => {
    expect(resolveSessionByName("does-not-exist")).toBeUndefined();
    expect(resolveSessionByName("totally/made/up")).toBeUndefined();
  });
});

describe("resolveSessionByName — alias fallback", () => {
  // A renamed session: its old name survives only as an alias.
  const renamed = createSession({ slug: "renamed-current" });
  recordSessionAlias("renamed-old", renamed.id);

  test("resolves a retired name through the alias table", () => {
    const r = resolveSessionByName("renamed-old");
    expect(r?.session.id).toBe(renamed.id);
  });

  test("returns the session's current identity, not the alias text", () => {
    const r = resolveSessionByName("renamed-old");
    expect(r?.slug).toBe("renamed-current");
  });

  test("resolves a pre-flatten category/slug name to the flattened session", () => {
    const r = resolveSessionByName("ssp/REV-367/fe-determination");
    expect(r?.session.id).toBe(flattened.id);
    expect(r?.slug).toBe("fe-determination");
  });

  test("a live slug wins over an alias of the same name", () => {
    // Alias claims the name of a real row; the live row must win.
    recordSessionAlias("get-table-screenshot", renamed.id);
    const r = resolveSessionByName("get-table-screenshot");
    expect(r?.session.id).toBe(plain.id);
  });

  test("misses still return undefined with aliases present", () => {
    expect(resolveSessionByName("still-not-a-session")).toBeUndefined();
  });
});

describe("isNameTakenByOtherSession", () => {
  const owner = createSession({ slug: "name-owner" });
  recordSessionAlias("name-owner-retired", owner.id);

  test("a live slug is taken", () => {
    expect(isNameTakenByOtherSession("name-owner", null)).toBe(true);
  });

  test("a name held only as an alias is taken too", () => {
    // The unique index doesn't cover it, so nothing else would stop a create
    // path from claiming it and stranding the session it points at.
    expect(isNameTakenByOtherSession("name-owner-retired", null)).toBe(true);
  });

  test("a free name is not taken", () => {
    expect(isNameTakenByOtherSession("nobody-holds-this", null)).toBe(false);
  });

  test("the holder itself is exempt, by slug and by alias", () => {
    expect(isNameTakenByOtherSession("name-owner", owner.id)).toBe(false);
    expect(isNameTakenByOtherSession("name-owner-retired", owner.id)).toBe(
      false,
    );
  });
});

describe("createSession name/nameSource contract", () => {
  test("rejects a derived row carrying its own display name", () => {
    // Sync throw: bun's toThrow is vacuous on an async fn, so this assertion
    // only means anything because createSession is synchronous.
    expect(() =>
      createSession({
        slug: "derived-with-name",
        name: "My Session",
        nameSource: "derived",
      }),
    ).toThrow(/named at pause/);
  });

  test("allows a derived row whose name merely repeats the slug", () => {
    const s = createSession({
      slug: "derived-echoing-slug",
      name: "derived-echoing-slug",
      nameSource: "derived",
    });
    expect(s.nameSource).toBe("derived");
  });

  test("a manual row may carry any display name", () => {
    const s = createSession({ slug: "manual-named", name: "Manual Named" });
    expect(s.name).toBe("Manual Named");
    expect(s.nameSource).toBe("manual");
  });
});

describe("createSession — derived session key", () => {
  test("persists the SessionKey fields and the groupKey verbatim", () => {
    const s = createSession({
      slug: "keyed",
      worktreeRoot: "/Users/x/orca/workspaces/bertrand/some-task",
      mainCheckout: "/Users/x/www/uiid/bertrand",
      branch: "adamfratino/some-task",
      repo: "uiid-systems/bertrand",
      groupKey: "uiid-systems/bertrand@adamfratino/some-task",
    });
    expect(s.worktreeRoot).toBe("/Users/x/orca/workspaces/bertrand/some-task");
    expect(s.mainCheckout).toBe("/Users/x/www/uiid/bertrand");
    expect(s.branch).toBe("adamfratino/some-task");
    expect(s.repo).toBe("uiid-systems/bertrand");
    expect(s.groupKey).toBe("uiid-systems/bertrand@adamfratino/some-task");
  });

  test("a cwd that resolved to nothing still records, ungrouped", () => {
    // The whole point of every key column being nullable: bertrand logs
    // sessions outside git, and refusing one here would make git a requirement
    // for recording work.
    const s = createSession({ slug: "keyless" });
    expect(s.groupKey).toBeNull();
    expect(s.repo).toBeNull();
    expect(s.worktreeRoot).toBeNull();
    expect(s.mainCheckout).toBeNull();
  });
});

describe("findOpenSessionByGroupKey", () => {
  const KEY = "uiid-systems/bertrand@feature/group-lookup";

  test("returns undefined for a key nothing holds", () => {
    expect(findOpenSessionByGroupKey("nobody/repo@nothing")).toBeUndefined();
  });

  test("finds the session holding the key", () => {
    const s = createSession({ slug: "grp-single", groupKey: KEY });
    expect(findOpenSessionByGroupKey(KEY)?.id).toBe(s.id);
  });

  test("the most recently updated row wins", () => {
    const older = createSession({ slug: "grp-older", groupKey: KEY + "-multi" });
    const newer = createSession({ slug: "grp-newer", groupKey: KEY + "-multi" });

    // Order the two explicitly rather than trusting insertion order: datetime()
    // has second resolution, so two rows created in the same tick tie.
    updateSession(older.id, { branch: "a" });
    updateSession(newer.id, { branch: "b" });
    testDb.$client
      .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
      .run("2020-01-01 00:00:00", older.id);

    expect(findOpenSessionByGroupKey(KEY + "-multi")?.id).toBe(newer.id);
  });

  test("archived rows are excluded — archiving is how a task is declared done", () => {
    const s = createSession({ slug: "grp-archived", groupKey: KEY + "-arch" });
    expect(findOpenSessionByGroupKey(KEY + "-arch")?.id).toBe(s.id);

    updateSessionStatus(s.id, "archived");

    expect(findOpenSessionByGroupKey(KEY + "-arch")).toBeUndefined();
  });

  test("an archived row does not shadow a newer open one on the same key", () => {
    // The follow-up run after an archive: it must get its own session, and it
    // must be the one that later runs attach to.
    const done = createSession({ slug: "grp-done", groupKey: KEY + "-again" });
    updateSessionStatus(done.id, "archived");
    const fresh = createSession({ slug: "grp-fresh", groupKey: KEY + "-again" });

    expect(findOpenSessionByGroupKey(KEY + "-again")?.id).toBe(fresh.id);
  });

  test("every non-archived status counts as open, paused included", () => {
    // `paused` is where the Stop hook leaves a session at the end of every
    // turn while claude keeps running, so treating it as closed would mint a
    // new session on the very next prompt.
    for (const status of ["active", "waiting", "blocked", "paused"] as const) {
      const key = `${KEY}-status-${status}`;
      const s = createSession({ slug: `grp-${status}`, groupKey: key });
      updateSessionStatus(s.id, status);
      expect(findOpenSessionByGroupKey(key)?.id).toBe(s.id);
    }
  });
});

describe("purgeSessionsBefore", () => {
  /** A session backdated past the cutoff, with a full set of child rows. */
  function stale(slug: string) {
    const s = createSession({ slug, groupKey: `stale/${slug}@main` });
    const conversation = createConversation({
      id: `conv-${slug}`,
      sessionId: s.id,
    });
    insertEvent({ sessionId: s.id, event: "session.started" });
    insertEvent({
      sessionId: s.id,
      conversationId: conversation.id,
      event: "tool.applied",
    });
    recordSessionAlias(`${slug}-retired`, s.id);
    testDb.insert(schema.sessionStats).values({ sessionId: s.id }).run();
    testDb
      .$client.prepare("UPDATE sessions SET created_at = ? WHERE id = ?")
      .run("2020-01-01 00:00:00", s.id);
    return { session: s, conversation };
  }

  const CUTOFF = "2021-01-01 00:00:00";

  test("deletes the backdated sessions and reports the counts", () => {
    const a = stale("purge-a");
    const b = stale("purge-b");

    const result = purgeSessionsBefore(CUTOFF);

    expect(result.sessions).toBe(2);
    expect(result.events).toBe(4);
    expect(getSession(a.session.id)).toBeUndefined();
    expect(getSession(b.session.id)).toBeUndefined();
  });

  test("takes the events with it", () => {
    const { session } = stale("purge-events");
    expect(getEventsBySession(session.id)).toHaveLength(2);

    purgeSessionsBefore(CUTOFF);

    expect(getEventsBySession(session.id)).toHaveLength(0);
  });

  test("cascades to conversations, stats and aliases", () => {
    const { session, conversation } = stale("purge-children");

    purgeSessionsBefore(CUTOFF);

    expect(getConversation(conversation.id)).toBeUndefined();
    expect(getSessionStats(session.id)).toBeUndefined();
    expect(resolveSessionByName("purge-children-retired")).toBeUndefined();
  });

  test("leaves sessions created at or after the cutoff alone", () => {
    // The rows every other test in this file depends on are all "now", so this
    // is also the assertion that a purge is not a truncate.
    const survivor = createSession({ slug: "purge-survivor" });
    insertEvent({ sessionId: survivor.id, event: "session.started" });
    stale("purge-doomed");

    const result = purgeSessionsBefore(CUTOFF);

    expect(result.sessions).toBe(1);
    expect(getSession(survivor.id)).toBeDefined();
    expect(getEventsBySession(survivor.id)).toHaveLength(1);
    expect(getSession(plain.id)).toBeDefined();
  });

  test("a cutoff matching nothing is a no-op", () => {
    const before = testDb.$client
      .prepare("SELECT count(*) as n FROM sessions")
      .get() as { n: number };

    expect(purgeSessionsBefore("1970-01-01 00:00:00")).toEqual({
      sessions: 0,
      events: 0,
    });

    const after = testDb.$client
      .prepare("SELECT count(*) as n FROM sessions")
      .get() as { n: number };
    expect(after.n).toBe(before.n);
  });
});
