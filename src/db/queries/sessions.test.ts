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
