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
  mkdtempSync(join(tmpdir(), "bertrand-derive-slug-test-")),
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

const { createCategory } = await import("@/db/queries/categories");
const { createSession, getSession, renameSession } = await import(
  "@/db/queries/sessions"
);
const { insertEvent } = await import("@/db/queries/events");
const { deriveSlugFromTexts, deriveSessionSlug, resolveSlugCollision } =
  await import("./derive-slug");

const SEGMENT_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

const category = createCategory({ slug: "cat", name: "cat" });

function makeSession(
  slug: string,
  opts?: { nameSource?: "manual" | "derived" },
) {
  return createSession({
    categoryId: category.id,
    slug,
    name: slug,
    nameSource: opts?.nameSource,
  });
}

describe("deriveSlugFromTexts", () => {
  test("imperative prompt keeps verb-object shape, PR link becomes a token", () => {
    expect(
      deriveSlugFromTexts([
        "fix up the merge conflicts in https://github.com/uiid-systems/orca/pull/220",
      ]),
    ).toBe("fix-merge-conflicts-pr-220");
  });

  test("drops stopwords and lowercases into kebab-case", () => {
    expect(
      deriveSlugFromTexts(["Refactor our sidebar to use collapsible panels"]),
    ).toBe("refactor-sidebar-collapsible-panels");
  });

  test("skips a slash-command opening and derives from the next prompt", () => {
    expect(
      deriveSlugFromTexts([
        "/agent-skills:test-driven-development",
        "add pagination to the sessions table",
      ]),
    ).toBe("add-pagination-sessions-table");
  });

  test("slash-command-only conversation derives null", () => {
    expect(
      deriveSlugFromTexts(["/agent-skills:test-driven-development"]),
    ).toBeNull();
  });

  test("no prompts derives null even with assistant text", () => {
    expect(deriveSlugFromTexts([], ["I fixed the bug and opened a PR"])).toBeNull();
  });

  test("all-stopword prompt derives null", () => {
    expect(deriveSlugFromTexts(["ok thanks, that was it"])).toBeNull();
  });

  test("caps at 5 tokens, preferring ones repeated across the conversation", () => {
    expect(
      deriveSlugFromTexts([
        "alpha beta gamma delta epsilon zeta",
        "gamma zeta gamma zeta",
      ]),
    ).toBe("alpha-beta-gamma-delta-zeta");
  });

  test("thin first prompt is supplemented from later prompts", () => {
    const slug = deriveSlugFromTexts([
      "the xterm?",
      "the terminal is not sized correctly, xterm sizing is wrong",
    ])!;
    expect(slug).toContain("xterm");
    expect(slug.split("-").length).toBeGreaterThanOrEqual(2);
  });

  test('bare "PR 152" reference merges into a pr-152 token', () => {
    expect(deriveSlugFromTexts(["have a thorough look at PR 152"])).toBe(
      "pr-152",
    );
  });

  test("standalone numbers are dropped", () => {
    expect(deriveSlugFromTexts(["update 42 things in 2024"])).toBe("update");
  });

  test("repeated words dedupe", () => {
    expect(deriveSlugFromTexts(["deploy deploy the deploy script"])).toBe(
      "deploy-script",
    );
  });

  test("punctuation-heavy input still yields a valid segment", () => {
    const slug = deriveSlugFromTexts(["FIX THE Login-Bug!!!"])!;
    expect(slug).toBe("fix-login-bug");
    expect(SEGMENT_PATTERN.test(slug)).toBe(true);
  });

  test("descriptive complaint prompts derive descriptive slugs", () => {
    const slug = deriveSlugFromTexts(["why does the terminal look like shit"])!;
    expect(slug).toContain("terminal");
    expect(SEGMENT_PATTERN.test(slug)).toBe(true);
  });

  test("code fences are ignored", () => {
    expect(
      deriveSlugFromTexts([
        "fix the parser\n```ts\nconst wholeBunch = ofIrrelevant + tokens;\n```",
      ]),
    ).toBe("fix-parser");
  });

  test("a Linear issue URL contributes its ticket id and title words", () => {
    const slug = deriveSlugFromTexts([
      "have a look at https://linear.app/uiid/issue/ELKY-150/p410-gh-cli-runner-with-typed-errors-and-concurrency-cap , let me know if you need anything otherwise get started. let's get to a PR if we can.",
    ])!;
    expect(slug).toContain("elky-150");
    expect(slug).toContain("cli");
    expect(slug).not.toContain("otherwise");
    expect(slug).not.toContain("started");
  });

  test("launch-template boilerplate derives just the reference", () => {
    expect(
      deriveSlugFromTexts([
        "have a look at issue 214, ask clarifying questions if anything is unclear, otherwise get started",
      ]),
    ).toBe("issue-214");
  });

  test("machine-injected task-notification prompts are skipped", () => {
    expect(
      deriveSlugFromTexts([
        "<task-notification>\n<task-id>brkytl713</task-id>\n<summary>Monitor event</summary>\n</task-notification>",
        "fix the login bug",
      ]),
    ).toBe("fix-login-bug");
  });

  test("contractions are filler, not tokens", () => {
    expect(
      deriveSlugFromTexts(["i've noticed the tooltips they're overflowing"]),
    ).toBe("noticed-tooltips-overflowing");
  });

  test("very long token runs stay under the length cap", () => {
    const slug = deriveSlugFromTexts([
      "synchronization infrastructure reorganization internationalization modernization",
    ])!;
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.split("-").length).toBeGreaterThanOrEqual(2);
  });
});

describe("deriveSessionSlug", () => {
  test("derives from the session's recorded prompts", () => {
    const s = makeSession("derive-basic");
    insertEvent({
      sessionId: s.id,
      event: "user.prompt",
      meta: { prompt: "fix the login bug" },
    });
    expect(deriveSessionSlug(s.id)).toBe("fix-login-bug");
  });

  test("uses all prompts, not just the first", () => {
    const s = makeSession("derive-later-intent");
    insertEvent({
      sessionId: s.id,
      event: "user.prompt",
      meta: { prompt: "/agent-skills:test-driven-development" },
      createdAt: "2026-07-10 10:00:00",
    });
    insertEvent({
      sessionId: s.id,
      event: "user.prompt",
      meta: { prompt: "migrate the events table to drizzle" },
      createdAt: "2026-07-10 10:01:00",
    });
    expect(deriveSessionSlug(s.id)).toBe("migrate-events-table-drizzle");
  });

  test("session with no prompts derives null", () => {
    const s = makeSession("derive-empty");
    insertEvent({ sessionId: s.id, event: "claude.started", meta: { cwd: "/x" } });
    expect(deriveSessionSlug(s.id)).toBeNull();
  });
});

describe("resolveSlugCollision", () => {
  test("returns the slug unchanged when no other session holds it", () => {
    const s = makeSession("collision-free");
    expect(resolveSlugCollision("totally-unique-slug", s.id)).toBe(
      "totally-unique-slug",
    );
  });

  test("suffixes -2 when another session holds the slug, even in another category", () => {
    const otherCategory = createCategory({ slug: "other", name: "other" });
    createSession({
      categoryId: otherCategory.id,
      slug: "taken-slug",
      name: "taken-slug",
    });
    const s = makeSession("collision-victim");
    expect(resolveSlugCollision("taken-slug", s.id)).toBe("taken-slug-2");
  });

  test("walks past every taken suffix", () => {
    makeSession("walked-slug");
    makeSession("walked-slug-2");
    const s = makeSession("collision-walker");
    expect(resolveSlugCollision("walked-slug", s.id)).toBe("walked-slug-3");
  });

  test("a session keeps a slug it already owns", () => {
    const s = makeSession("self-owned");
    expect(resolveSlugCollision("self-owned", s.id)).toBe("self-owned");
  });
});

describe("renameSession", () => {
  test("stamps nameSource manual so derivation never overwrites a chosen name", () => {
    const s = makeSession("rename-me", { nameSource: "derived" });
    renameSession(s.id, "my-chosen-name");
    expect(getSession(s.id)?.nameSource).toBe("manual");
  });
});
