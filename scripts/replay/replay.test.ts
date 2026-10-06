import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { cutSnapshot } from "./snapshot";
import { isCorrect, verdict, type RunRecord } from "./report";

describe("cutSnapshot", () => {
  test("keeps only what existed before the cut, in either time format", () => {
    const dir = mkdtempSync(join(tmpdir(), "bertrand-replay-test-"));
    try {
    const source = join(dir, "source.db");
    const db = new Database(source);
    migrate(drizzle(db), { migrationsFolder: join(import.meta.dir, "..", "..", "src", "db", "migrations") });
    db.exec(`
      INSERT INTO sessions (id, slug, summary, started_at) VALUES
        ('old', 'old', 'the future outcome', '2026-09-01 09:00:00'),
        ('new', 'new', null, '2026-09-03 09:00:00'),
        ('task', 'task', null, '2026-09-02 12:00:00');
      INSERT INTO conversations (id, session_id, started_at) VALUES
        ('c-old', 'old', '2026-09-01 09:00:00'),
        ('c-later', 'old', '2026-09-02 13:00:00'),
        ('c-task', 'task', '2026-09-02 12:00:00');
      INSERT INTO events (session_id, conversation_id, event, meta, created_at) VALUES
        ('old', 'c-old', 'user.prompt', '{"prompt":"before"}', '2026-09-02 11:00:00'),
        ('old', 'c-old', 'assistant.message', '{"text":"iso before"}', '2026-09-02T11:59:59.000Z'),
        ('old', 'c-old', 'assistant.message', '{"text":"iso after"}', '2026-09-02T12:00:01.000Z'),
        ('old', 'c-later', 'user.prompt', '{"prompt":"later"}', '2026-09-02 13:00:00'),
        ('new', null, 'user.prompt', '{"prompt":"new"}', '2026-09-03 09:00:00'),
        ('task', 'c-task', 'user.prompt', '{"prompt":"the task itself"}', '2026-09-02 12:00:00');
    `);
    db.close();

    const cut = new Database(cutSnapshot(source, join(dir, "home"), "2026-09-02 12:00:00"));
    const col = (sql: string) => cut.query(sql).all().map((r) => Object.values(r as object)[0]);
    // The task's own session and conversation start exactly at the cut and
    // must survive it; its prompt, at the cut too, must not.
    expect(col("SELECT id FROM sessions ORDER BY id")).toEqual(["old", "task"]);
    expect(col("SELECT id FROM conversations ORDER BY id")).toEqual(["c-old", "c-task"]);
    expect(col("SELECT coalesce(json_extract(meta, '$.prompt'), json_extract(meta, '$.text')) FROM events ORDER BY id")).toEqual([
      "before",
      "iso before",
    ]);
    // Written after the cut by construction.
    expect(col("SELECT summary FROM sessions")).toEqual([null, null]);
    // The source is untouched.
    expect(new Database(source).query("SELECT count(*) AS n FROM events").get()).toEqual({ n: 6 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("verdict", () => {
  const run = (task: string, arm: RunRecord["arm"], processed: number, correct = true): RunRecord => ({
    task, arm, rep: 1, processed, requests: 10, systemBytes: 4000, correct,
  });

  test("pairs each task with itself and reports the median ratio", () => {
    const v = verdict([
      run("a", "control", 1_000_000), run("a", "treatment", 800_000),
      run("b", "control", 4_000_000), run("b", "treatment", 3_000_000),
      run("c", "control", 2_000_000), run("c", "treatment", 1_800_000),
      // Unpaired and errored runs don't count.
      run("d", "control", 9_000_000),
      { ...run("a", "treatment", 1), error: "exit 1" },
    ])!;
    expect(v.tasks.map((t) => t.task)).toEqual(["a", "b", "c"]);
    expect(v.medianRatio).toBeCloseTo(0.8, 5);
    expect(v.ci[0]).toBeLessThanOrEqual(v.medianRatio);
    expect(v.ci[1]).toBeGreaterThanOrEqual(v.medianRatio);
    expect(v.ship).toBe(true);
  });

  test("a cheaper but less correct treatment doesn't ship", () => {
    const v = verdict([
      run("a", "control", 1_000_000), run("a", "treatment", 500_000, false),
      run("b", "control", 1_000_000), run("b", "treatment", 500_000),
    ])!;
    expect(v.medianRatio).toBeCloseTo(0.5, 5);
    expect(v.ship).toBe(false);
  });

  test("nothing to say without a paired task", () => {
    expect(verdict([run("a", "control", 1)])).toBeNull();
  });
});

test("isCorrect needs every fact of the key, case-insensitively", () => {
  expect(isCorrect("It lives in src/contract/Context.ts, capped at 5.", ["context.ts", "5"])).toBe(true);
  expect(isCorrect("It lives in context.ts.", ["context.ts", "5"])).toBe(false);
});
