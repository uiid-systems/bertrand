import { describe, test, expect, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as schema from "@/db/schema";
import { _setDb } from "@/db/client";

const TEST_DIR = mkdtempSync(join(tmpdir(), "bertrand-diffstats-test-"));
const sqlite = new Database(join(TEST_DIR, "test.db"));
sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec("PRAGMA foreign_keys = ON");

const testDb = drizzle(sqlite, { schema });
_setDb(testDb);

migrate(drizzle(sqlite), {
  migrationsFolder: join(import.meta.dir, "..", "db", "migrations"),
});

const { createCategory } = await import("@/db/queries/categories");
const { createSession } = await import("@/db/queries/sessions");
const { createConversation } = await import("@/db/queries/conversations");
const { emitToolApplied } = await import("@/db/events/emit");
const { computeChangedFiles, resolveChangedFiles } = await import(
  "@/lib/diff_stats"
);

afterAll(() => rmSync(TEST_DIR, { recursive: true, force: true }));

const category = createCategory({ slug: "diffstats", name: "Diff Stats" });
let n = 0;

/** A session with one edit per path, each adding a single line. */
function sessionEditing(...paths: string[]) {
  const slug = `diffstats-${n++}`;
  const session = createSession({ categoryId: category.id, slug, name: slug });
  const conversationId = crypto.randomUUID();
  createConversation({ id: conversationId, sessionId: session.id });

  emitToolApplied({
    sessionId: session.id,
    conversationId,
    summary: "edited",
    permissions: paths.map((detail) => ({
      tool: "Edit",
      detail,
      outcome: "applied" as const,
      count: 1,
      newStr: "added line",
    })),
  });

  return session.id;
}

const REPO = "/Users/dev/projects/acme";

describe("computeChangedFiles display paths", () => {
  test("renders repo-relative against the root it is given", () => {
    const id = sessionEditing(`${REPO}/src/index.ts`);
    const files = computeChangedFiles(id, REPO);
    expect(files.map((f) => f.path)).toEqual(["src/index.ts"]);
  });

  test("the root is the argument, not wherever the process is standing", () => {
    // P3.9's actual defect: this read `process.cwd()`, so `bertrand serve`
    // launched from /tmp matched nothing and the sidebar rendered every path
    // absolute. chdir'ing somewhere unrelated must not change the answer.
    const id = sessionEditing(`${REPO}/src/index.ts`);
    const elsewhere = mkdtempSync(join(tmpdir(), "bertrand-diffstats-cwd-"));
    const originalCwd = process.cwd();
    try {
      process.chdir(elsewhere);
      expect(computeChangedFiles(id, REPO).map((f) => f.path)).toEqual([
        "src/index.ts",
      ]);
    } finally {
      process.chdir(originalCwd);
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  test("a repo path is never mistaken for relative just because cwd matches", () => {
    // The inverse guard. Standing *inside* a directory that would have matched
    // under the old behavior must not rescue a call given the wrong root.
    const id = sessionEditing(`${TEST_DIR}/src/index.ts`);
    const originalCwd = process.cwd();
    try {
      process.chdir(TEST_DIR);
      expect(computeChangedFiles(id, REPO).map((f) => f.path)).toEqual([
        `${TEST_DIR}/src/index.ts`,
      ]);
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("collapses the .claude/worktrees/<name>/ infix to the logical repo path", () => {
    const id = sessionEditing(
      `${REPO}/.claude/worktrees/feature-x/src/components/Button.tsx`,
    );
    expect(computeChangedFiles(id, REPO).map((f) => f.path)).toEqual([
      "src/components/Button.tsx",
    ]);
  });

  test("collapse and root-strip compose in either order of appearance", () => {
    const id = sessionEditing(
      `${REPO}/.claude/worktrees/wt-a/src/a.ts`,
      `${REPO}/src/b.ts`,
    );
    expect(computeChangedFiles(id, REPO).map((f) => f.path).sort()).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  test("an unbound project has no root, so paths stay absolute", () => {
    const id = sessionEditing(`${REPO}/src/index.ts`);
    expect(computeChangedFiles(id, undefined).map((f) => f.path)).toEqual([
      `${REPO}/src/index.ts`,
    ]);
  });

  test("a path outside the root falls back to absolute, worktree infix still collapsed", () => {
    const id = sessionEditing(
      "/Users/dev/projects/other/.claude/worktrees/wt/src/z.ts",
    );
    expect(computeChangedFiles(id, REPO).map((f) => f.path)).toEqual([
      "/Users/dev/projects/other/src/z.ts",
    ]);
  });

  test("a sibling root sharing a prefix is not stripped", () => {
    // `${REPO}-legacy` starts with REPO but is a different repo; the trailing
    // separator in the comparison is what keeps it whole.
    const id = sessionEditing(`${REPO}-legacy/src/index.ts`);
    expect(computeChangedFiles(id, REPO).map((f) => f.path)).toEqual([
      `${REPO}-legacy/src/index.ts`,
    ]);
  });
});

describe("resolveChangedFiles replays the timeline", () => {
  test("returns the files the session's events touched", async () => {
    const id = sessionEditing(`${REPO}/src/a.ts`);
    const files = await resolveChangedFiles({ id }, REPO);
    expect(files.map((f) => f.path)).toEqual(["src/a.ts"]);
  });

  // Regression guard for the worktree teardown (ELKY-163). There was once a
  // git arm that took precedence whenever a worktree existed on disk; a
  // session whose events and working tree disagreed would be served git's
  // answer. Now there is one arm, so the events are always what is rendered
  // — including for sessions that still carry a stale worktree_path.
  test("ignores any path on the session and always uses the events", async () => {
    const id = sessionEditing(`${REPO}/src/only-in-events.ts`);
    const files = await resolveChangedFiles({ id }, REPO);
    expect(files.map((f) => f.path)).toEqual(["src/only-in-events.ts"]);
  });
});
