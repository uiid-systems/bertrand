import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import * as schema from "@/db/schema";
import { _setDb } from "@/db/client";

// Temp DB so renames have somewhere to land. The override is set at top
// level, which runs before any test body.
const TEST_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "bertrand-rename-")),
  "test.db",
);
const sqlite = new Database(TEST_DB_PATH);
sqlite.exec("PRAGMA foreign_keys = ON");
_setDb(drizzle(sqlite, { schema }));
migrate(drizzle(sqlite), {
  migrationsFolder: join(import.meta.dir, "..", "..", "db", "migrations"),
});

const { createSession, resolveSessionByName, getSession } = await import(
  "@/db/queries/sessions"
);
const { recordSessionAlias } = await import("@/db/queries/session-aliases");
const { runRename } = await import("./rename");

describe("runRename — success path", () => {
  test("renames, keeps the old name resolving, and stamps manual", () => {
    const s = createSession({
      slug: "first-draft",
      nameSource: "derived",
    });

    const result = runRename("first-draft", "final-cut");

    expect(result).toEqual({
      ok: true,
      noop: false,
      oldName: "first-draft",
      newName: "final-cut",
    });

    // New name is the session's identity now.
    const byNew = resolveSessionByName("final-cut");
    expect(byNew?.session.id).toBe(s.id);

    // The retired name still resolves — to the current identity.
    const byOld = resolveSessionByName("first-draft");
    expect(byOld?.session.id).toBe(s.id);
    expect(byOld?.slug).toBe("final-cut");

    expect(getSession(s.id)?.nameSource).toBe("manual");
  });

  test("resolves the target through an alias", () => {
    const s = createSession({ slug: "current-name" });
    recordSessionAlias("ancient-name", s.id);

    const result = runRename("ancient-name", "newest-name");

    expect(result.ok).toBe(true);
    expect(resolveSessionByName("newest-name")?.session.id).toBe(s.id);
  });
});

describe("runRename — no-op", () => {
  test("renaming to the current slug succeeds without changing anything", () => {
    const s = createSession({
      slug: "steady",
      nameSource: "derived",
    });

    const result = runRename("steady", "steady");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.noop).toBe(true);
    // A no-op is not the user renaming — nameSource must be untouched.
    expect(getSession(s.id)?.nameSource).toBe("derived");
  });
});

describe("runRename — collisions", () => {
  test("rejects when another session holds the slug", () => {
    createSession({ slug: "taken" });
    createSession({ slug: "mover" });

    const result = runRename("mover", "taken");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("collision");
      expect(result.message).toContain("taken");
    }
    // Nothing moved.
    expect(resolveSessionByName("mover")?.slug).toBe("mover");
  });

  test("rejects when an alias maps the new name to another session", () => {
    const holder = createSession({ slug: "alias-holder" });
    recordSessionAlias("claimed-name", holder.id);
    createSession({ slug: "claimant" });

    const result = runRename("claimant", "claimed-name");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("collision");
      expect(result.message).toContain("alias-holder");
    }
  });

  test("allows a rename onto a name whose alias already points at this session", () => {
    const s = createSession({ slug: "round-trip" });
    recordSessionAlias("original", s.id);

    // Renaming back to a name this session used to hold is not a collision.
    const result = runRename("round-trip", "original");
    expect(result.ok).toBe(true);
  });
});

describe("runRename — rejections", () => {
  test("rejects an invalid slug", () => {
    createSession({ slug: "valid" });

    const result = runRename("valid", "-starts-with-dash");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid-slug");
  });

  test("rejects an unknown session with the form to use", () => {
    const result = runRename("no-such-session", "anything");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("not-found");
      expect(result.message).toContain("bertrand list");
    }
  });
});
