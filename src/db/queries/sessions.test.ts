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

const { createCategory } = await import("@/db/queries/categories");
const { createSession, resolveSessionByName } = await import(
  "@/db/queries/sessions"
);
const { recordSessionAlias } = await import("@/db/queries/session-aliases");

// Flat root category (current taxonomy).
const ssp = createCategory({ slug: "ssp", name: "ssp" });
// Legacy nested category (depth 1) left behind by the pre-#129 model.
const sspRev = createCategory({
  slug: "REV-367",
  name: "REV-367",
  parentId: ssp.id,
});

// A current-model row: flat category + slash-bearing slug.
createSession({ categoryId: ssp.id, slug: "REV-367/clean-up-ui", name: "ssp/REV-367/clean-up-ui" });
// A legacy row: nested category + plain slug.
createSession({ categoryId: sspRev.id, slug: "fe-determination", name: "ssp/REV-367/fe-determination" });
// A plain two-segment row.
createSession({ categoryId: ssp.id, slug: "get-table-screenshot", name: "ssp/get-table-screenshot" });

describe("resolveSessionByName", () => {
  test("resolves a plain two-segment name", () => {
    const r = resolveSessionByName("ssp/get-table-screenshot");
    expect(r?.categoryPath).toBe("ssp");
    expect(r?.slug).toBe("get-table-screenshot");
  });

  test("resolves a current-model slash-bearing slug (flat category)", () => {
    const r = resolveSessionByName("ssp/REV-367/clean-up-ui");
    expect(r?.categoryPath).toBe("ssp");
    expect(r?.slug).toBe("REV-367/clean-up-ui");
  });

  test("falls back to legacy nested-category resolution", () => {
    const r = resolveSessionByName("ssp/REV-367/fe-determination");
    expect(r?.categoryPath).toBe("ssp/REV-367");
    expect(r?.slug).toBe("fe-determination");
  });

  test("prefers the current-model row when both eras could match", () => {
    // The flat (current) interpretation must win — clean-up-ui lives under the
    // flat `ssp` category, not a nested `ssp/REV-367/clean-up-ui`.
    const r = resolveSessionByName("ssp/REV-367/clean-up-ui");
    expect(r?.categoryPath).toBe("ssp");
  });

  test("returns undefined for an unknown session", () => {
    expect(resolveSessionByName("ssp/REV-367/does-not-exist")).toBeUndefined();
    expect(resolveSessionByName("totally/made/up")).toBeUndefined();
  });
});

describe("resolveSessionByName — alias fallback", () => {
  // A renamed session: its old canonical name survives only as an alias.
  const renamed = createSession({
    categoryId: ssp.id,
    slug: "renamed-current",
    name: "ssp/renamed-current",
  });
  recordSessionAlias("ssp/renamed-old", renamed.id);

  test("resolves a retired name through the alias table", () => {
    const r = resolveSessionByName("ssp/renamed-old");
    expect(r?.session.id).toBe(renamed.id);
  });

  test("returns the session's current identity, not the alias text", () => {
    const r = resolveSessionByName("ssp/renamed-old");
    expect(r?.categoryPath).toBe("ssp");
    expect(r?.slug).toBe("renamed-current");
  });

  test("flat interpretation still wins over an alias of the same name", () => {
    // Alias claims the name of a real flat row; the live row must win.
    recordSessionAlias("ssp/get-table-screenshot", renamed.id);
    const r = resolveSessionByName("ssp/get-table-screenshot");
    expect(r?.slug).toBe("get-table-screenshot");
    expect(r?.session.id).not.toBe(renamed.id);
  });

  test("legacy interpretation still wins over an alias of the same name", () => {
    recordSessionAlias("ssp/REV-367/fe-determination", renamed.id);
    const r = resolveSessionByName("ssp/REV-367/fe-determination");
    expect(r?.slug).toBe("fe-determination");
    expect(r?.session.id).not.toBe(renamed.id);
  });

  test("misses still return undefined with aliases present", () => {
    expect(resolveSessionByName("ssp/still-not-a-session")).toBeUndefined();
  });
});
