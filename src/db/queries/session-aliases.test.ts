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
  mkdtempSync(join(tmpdir(), "bertrand-aliases-test-")),
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

const { createSession, deleteSession } = await import("@/db/queries/sessions");
const { recordSessionAlias, getSessionByAlias, isAliasTakenByOtherSession } =
  await import("@/db/queries/session-aliases");

const alpha = createSession({ slug: "alpha" });
const beta = createSession({ slug: "beta" });

describe("recordSessionAlias / getSessionByAlias", () => {
  test("round-trips an alias to the session's current identity", () => {
    recordSessionAlias("proj/old-alpha", alpha.id);

    const r = getSessionByAlias("proj/old-alpha");
    expect(r?.session.id).toBe(alpha.id);
    // Current identity, not the alias text.
    expect(r?.slug).toBe("alpha");
  });

  test("re-recording the same alias for the same session does not throw", () => {
    recordSessionAlias("proj/old-alpha", alpha.id);
    recordSessionAlias("proj/old-alpha", alpha.id);

    expect(getSessionByAlias("proj/old-alpha")?.session.id).toBe(alpha.id);
  });

  test("re-recording an alias for a different session keeps the original mapping", () => {
    recordSessionAlias("proj/old-alpha", beta.id);

    expect(getSessionByAlias("proj/old-alpha")?.session.id).toBe(alpha.id);
  });

  test("returns undefined for an unrecorded alias", () => {
    expect(getSessionByAlias("proj/never-recorded")).toBeUndefined();
  });
});

describe("isAliasTakenByOtherSession", () => {
  test("false when the alias is unrecorded", () => {
    expect(isAliasTakenByOtherSession("proj/unclaimed", alpha.id)).toBe(false);
  });

  test("false when the alias points at the same session", () => {
    recordSessionAlias("proj/old-alpha", alpha.id);
    expect(isAliasTakenByOtherSession("proj/old-alpha", alpha.id)).toBe(false);
  });

  test("true when the alias points at a different session", () => {
    recordSessionAlias("proj/old-alpha", alpha.id);
    expect(isAliasTakenByOtherSession("proj/old-alpha", beta.id)).toBe(true);
  });
});

describe("session deletion", () => {
  test("cascades away the session's aliases", () => {
    const doomed = createSession({ slug: "doomed" });
    recordSessionAlias("proj/old-doomed", doomed.id);
    expect(getSessionByAlias("proj/old-doomed")?.session.id).toBe(doomed.id);

    deleteSession(doomed.id);

    expect(getSessionByAlias("proj/old-doomed")).toBeUndefined();
  });
});
