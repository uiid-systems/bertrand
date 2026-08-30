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

const { createSession, resolveSessionByName, isNameTakenByOtherSession } =
  await import("@/db/queries/sessions");
const { recordSessionAlias } = await import("@/db/queries/session-aliases");

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
