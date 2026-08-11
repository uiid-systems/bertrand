import { describe, test, expect, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as schema from "@/db/schema";
import { _setDb } from "@/db/client";
import type { ChangedFile } from "@/lib/git-types";

const TEST_DIR = mkdtempSync(join(tmpdir(), "bertrand-snapshot-test-"));
const sqlite = new Database(join(TEST_DIR, "test.db"));
sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec("PRAGMA foreign_keys = ON");

const testDb = drizzle(sqlite, { schema });
_setDb(testDb);

migrate(drizzle(sqlite), {
  migrationsFolder: join(import.meta.dir, "..", "db", "migrations"),
});

const { createCategory } = await import("@/db/queries/categories");
const { createSession, updateSession, getSession } = await import(
  "@/db/queries/sessions"
);
const { getSessionStats, upsertSessionStats } = await import(
  "@/db/queries/stats"
);
const { computeAndPersist } = await import("@/lib/timing");
const { snapshotGitDiffStats } = await import("@/lib/stats-snapshot");

afterAll(() => rmSync(TEST_DIR, { recursive: true, force: true }));

const category = createCategory({ slug: "snapshot", name: "Snapshot" });
let n = 0;

/** A paused session, optionally holding a worktree directory that exists. */
function makeSession(opts: { worktree?: boolean } = {}) {
  const slug = `snapshot-${n++}`;
  const session = createSession({ categoryId: category.id, slug, name: slug });
  if (opts.worktree) {
    const path = join(TEST_DIR, `wt-${slug}`);
    mkdirSync(path, { recursive: true });
    updateSession(session.id, { worktreePath: path, worktreeBranch: slug });
  }
  return getSession(session.id)!;
}

/** A reader standing in for git, so the counters under test are exact. */
const reads =
  (...files: ChangedFile[]) =>
  async () =>
    files;

const file = (
  path: string,
  added: number | null,
  removed: number | null,
): ChangedFile => ({ path, added, removed, status: "modified" });

describe("snapshotGitDiffStats", () => {
  test("stores git's counters and marks the row as git-derived", async () => {
    const session = makeSession({ worktree: true });

    const diff = await snapshotGitDiffStats(session, {
      read: reads(file("a.ts", 10, 2), file("b.ts", 5, 1)),
    });

    expect(diff).toEqual({ linesAdded: 15, linesRemoved: 3, filesTouched: 2 });
    const stored = getSessionStats(session.id)!;
    expect(stored.linesAdded).toBe(15);
    expect(stored.linesRemoved).toBe(3);
    expect(stored.filesTouched).toBe(2);
    expect(stored.diffSource).toBe("git");
  });

  test("materializes a stats row for a session that never had one", async () => {
    const session = makeSession({ worktree: true });
    expect(getSessionStats(session.id)).toBeUndefined();

    await snapshotGitDiffStats(session, { read: reads(file("a.ts", 4, 0)) });

    // The targeted diff write updates three columns; without materializing
    // first it would match no rows and the capture would be lost.
    expect(getSessionStats(session.id)?.linesAdded).toBe(4);
  });

  test("counts untracked files without moving the line totals", async () => {
    const session = makeSession({ worktree: true });

    // `--numstat` never saw them, so their counts are null — the same shape the
    // changed-files list renders.
    const diff = await snapshotGitDiffStats(session, {
      read: reads(file("a.ts", 7, 0), {
        path: "new.ts",
        added: null,
        removed: null,
        status: "untracked",
      }),
    });

    expect(diff).toEqual({ linesAdded: 7, linesRemoved: 0, filesTouched: 2 });
  });

  test("captures nothing when the session has no worktree", async () => {
    const session = makeSession();

    const diff = await snapshotGitDiffStats(session, {
      read: reads(file("a.ts", 9, 9)),
    });

    expect(diff).toBeNull();
    expect(getSessionStats(session.id)).toBeUndefined();
  });

  test("captures nothing when the worktree directory is already gone", async () => {
    // The column outlives the directory. git answers a missing worktree with an
    // empty list, so trusting the column here would write zeros over the row.
    const session = makeSession({ worktree: true });
    await snapshotGitDiffStats(session, { read: reads(file("a.ts", 12, 3)) });
    rmSync(session.worktreePath!, { recursive: true, force: true });

    const diff = await snapshotGitDiffStats(session, { read: reads() });

    expect(diff).toBeNull();
    expect(getSessionStats(session.id)?.linesAdded).toBe(12);
  });

  test("refuses to overwrite stored counters with an empty git answer", async () => {
    // An empty diff is ambiguous: a clean worktree, a git that failed, or — the
    // common one — a branch whose work has merged, moving the merge base up to
    // the tip. None of those are grounds for blanking a session's history.
    const session = makeSession({ worktree: true });
    await snapshotGitDiffStats(session, { read: reads(file("a.ts", 20, 4)) });

    const diff = await snapshotGitDiffStats(session, { read: reads() });

    expect(diff).toBeNull();
    const stored = getSessionStats(session.id)!;
    expect(stored.linesAdded).toBe(20);
    expect(stored.linesRemoved).toBe(4);
  });

  test("leaves the row untouched when nothing moved", async () => {
    const session = makeSession({ worktree: true });
    await snapshotGitDiffStats(session, { read: reads(file("a.ts", 3, 1)) });

    // `datetime('now')` is second-resolution, so a sentinel is the only way to
    // see a rewrite that happens within the same second as the first write.
    testDb.run(
      `UPDATE session_stats SET updated_at = '1999-01-01 00:00:00' WHERE session_id = '${session.id}'`,
    );

    const diff = await snapshotGitDiffStats(session, {
      read: reads(file("a.ts", 3, 1)),
    });

    expect(diff).toEqual({ linesAdded: 3, linesRemoved: 1, filesTouched: 1 });
    expect(getSessionStats(session.id)?.updatedAt).toBe("1999-01-01 00:00:00");
  });
});

describe("computeAndPersist", () => {
  test("does not downgrade a git snapshot to an event replay", async () => {
    // Once the worktree is gone the replay is all that can be recomputed, and
    // it measures something else — what the agent typed, not what the branch
    // changed. Finalizing a resumed session must not trade one for the other.
    const session = makeSession({ worktree: true });
    await snapshotGitDiffStats(session, { read: reads(file("a.ts", 42, 8)) });

    const data = computeAndPersist(session.id);

    expect(data.linesAdded).toBe(42);
    expect(data.linesRemoved).toBe(8);
    expect(data.diffSource).toBe("git");
    expect(getSessionStats(session.id)?.linesAdded).toBe(42);
  });

  test("still writes event-derived counters for a session with no snapshot", async () => {
    const session = makeSession();

    const data = computeAndPersist(session.id);

    expect(data.diffSource).toBe("events");
    expect(getSessionStats(session.id)?.diffSource).toBe("events");
  });

  test("keeps recomputing everything else on a snapshotted row", async () => {
    // The freeze is scoped to the three diff counters — timings, token rollups
    // and counts stay recomputable from events.
    const session = makeSession({ worktree: true });
    await snapshotGitDiffStats(session, { read: reads(file("a.ts", 5, 5)) });
    upsertSessionStats(
      session.id,
      {
        eventCount: 999,
        conversationCount: 999,
        interactionCount: 999,
        claudeWorkS: 999,
        userWaitS: 999,
        activePct: 99,
        durationS: 999,
        linesAdded: 5,
        linesRemoved: 5,
        filesTouched: 1,
        diffSource: "git",
        inputTokens: 999,
        outputTokens: 999,
        cacheCreationTokens: 999,
        cacheReadTokens: 999,
      },
      testDb,
    );

    computeAndPersist(session.id);

    const stored = getSessionStats(session.id)!;
    expect(stored.eventCount).toBe(0);
    expect(stored.linesAdded).toBe(5);
    expect(stored.diffSource).toBe("git");
  });
});
