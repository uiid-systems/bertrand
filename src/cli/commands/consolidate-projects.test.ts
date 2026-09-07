import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { _setRootDir, paths } from "@/lib/paths";
import { runConsolidateProjects } from "./consolidate-projects";

const MIGRATIONS = join(import.meta.dir, "..", "..", "db", "migrations");

let root: string;

/**
 * A per-project database frozen at migration 0018 — the schema the real ones
 * are actually sitting at: `rating` still present, none of the session-key
 * columns, `name` not yet dropped. Consolidation has to migrate them forward
 * itself, so building them any other way would test the wrong thing.
 */
function legacyMigrationsFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), "bertrand-pre0019-"));
  mkdirSync(join(dir, "meta"), { recursive: true });
  for (const f of readdirSync(MIGRATIONS)) {
    if (f.endsWith(".sql")) cpSync(join(MIGRATIONS, f), join(dir, f));
  }
  const journal = JSON.parse(
    JSON.stringify(require(join(MIGRATIONS, "meta", "_journal.json"))),
  ) as { entries: { idx: number }[] };
  journal.entries = journal.entries.filter((e) => e.idx <= 18);
  writeFileSync(
    join(dir, "meta", "_journal.json"),
    JSON.stringify(journal, null, 2),
  );
  return dir;
}

function seedProject(
  slug: string,
  sessions: { id: string; slug: string; branch: string | null }[],
): void {
  const dir = join(root, "projects", slug);
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, "bertrand.db"));
  db.exec("PRAGMA foreign_keys = ON");
  migrate(drizzle(db), { migrationsFolder: legacyMigrationsFolder() });

  for (const s of sessions) {
    db.query(
      `INSERT INTO sessions (id, slug, name, status, branch, started_at)
       VALUES (?1, ?2, ?2, 'paused', ?3, '2026-01-01 10:00:00')`,
    ).run(s.id, s.slug, s.branch);
    const conv = `${s.id}-conv`;
    db.query("INSERT INTO conversations (id, session_id) VALUES (?1, ?2)").run(
      conv,
      s.id,
    );
    for (const event of ["claude.started", "user.prompt"]) {
      db.query(
        "INSERT INTO events (session_id, conversation_id, event) VALUES (?1, ?2, ?3)",
      ).run(s.id, conv, event);
    }
    db.query(
      "INSERT INTO session_stats (session_id, event_count) VALUES (?1, 2)",
    ).run(s.id);
  }

  // A label name both projects use, so dedup-by-name is exercised.
  const labelId = `lab-${slug}`;
  db.query("INSERT INTO labels (id, name) VALUES (?1, 'urgent')").run(labelId);
  db.query(
    "INSERT INTO session_labels (session_id, label_id) VALUES (?1, ?2)",
  ).run(sessions[0]!.id, labelId);
  db.query(
    "INSERT INTO session_aliases (alias, session_id) VALUES (?1, ?2)",
  ).run(`legacy/${sessions[0]!.slug}`, sessions[0]!.id);
  db.close();
}

function target(): Database {
  return new Database(paths.db);
}

const one = <T>(db: Database, sql: string): T =>
  db.query(sql).get() as T;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "bertrand-consolidate-test-"));
  _setRootDir(root);

  seedProject("bertrand", [
    { id: "b-1", slug: "finish-up", branch: "elky-179" },
    { id: "b-2", slug: "new-0dqjum", branch: "ui-182" },
  ]);
  // Same slug in a second project — legal there, a collision once merged.
  seedProject("design-system", [
    { id: "d-1", slug: "finish-up", branch: "ui-500" },
    { id: "d-2", slug: "ui-196-wrap", branch: null },
  ]);
  // No entry in projects.json: ungrouped, but still imported.
  seedProject("unregistered", [
    { id: "u-1", slug: "orphan-work", branch: "x-1" },
  ]);

  writeFileSync(
    join(root, "projects.json"),
    JSON.stringify({
      projects: [
        {
          slug: "bertrand",
          repo: {
            path: "/w/bertrand",
            provider: { provider: "github", owner: "uiid-systems", repo: "bertrand" },
          },
        },
        {
          slug: "design-system",
          repo: {
            path: "/w/ds",
            provider: { provider: "github", owner: "uiid-systems", repo: "design-system" },
          },
        },
      ],
    }),
  );
});

afterAll(() => {
  _setRootDir(null);
  rmSync(root, { recursive: true, force: true });
});

describe("runConsolidateProjects", () => {
  test("a dry run reports the whole import and writes nothing", () => {
    const { projects } = runConsolidateProjects({ dryRun: true });

    expect(projects.map((p) => p.slug).sort()).toEqual([
      "bertrand",
      "design-system",
      "unregistered",
    ]);
    expect(projects.reduce((n, p) => n + p.sessions, 0)).toBe(5);

    const db = target();
    expect(one<{ n: number }>(db, "SELECT count(*) n FROM sessions").n).toBe(0);
    db.close();
  });

  test("imports every session, its conversations, events and stats", () => {
    const { projects } = runConsolidateProjects();
    expect(projects.reduce((n, p) => n + p.sessions, 0)).toBe(5);

    const db = target();
    expect(one<{ n: number }>(db, "SELECT count(*) n FROM sessions").n).toBe(5);
    expect(one<{ n: number }>(db, "SELECT count(*) n FROM conversations").n).toBe(5);
    expect(one<{ n: number }>(db, "SELECT count(*) n FROM events").n).toBe(10);
    expect(one<{ n: number }>(db, "SELECT count(*) n FROM session_stats").n).toBe(5);
    db.close();
  });

  test("reassigns event ids so per-database autoincrement can't collide", () => {
    const db = target();
    // Every source numbered its events from 1; the merged table must not.
    expect(one<{ n: number }>(db, "SELECT count(DISTINCT id) n FROM events").n).toBe(10);
    expect(
      one<{ n: number }>(
        db,
        "SELECT count(*) n FROM events e LEFT JOIN sessions s ON s.id = e.session_id WHERE s.id IS NULL",
      ).n,
    ).toBe(0);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  test("fills repo and checkout from the registry, and leaves groupKey null", () => {
    const db = target();
    const row = db
      .query("SELECT repo, main_checkout, group_key, worktree_root FROM sessions WHERE id = 'b-1'")
      .get() as Record<string, unknown>;

    expect(row.repo).toBe("uiid-systems/bertrand");
    expect(row.main_checkout).toBe("/w/bertrand");
    // Never reconstructed: a group key would let a new run attach to a
    // months-old imported session, and the worktree path was never recorded.
    expect(row.group_key).toBeNull();
    expect(row.worktree_root).toBeNull();
    db.close();
  });

  test("a project with no registry entry imports ungrouped rather than being skipped", () => {
    const db = target();
    const row = db
      .query("SELECT slug, repo FROM sessions WHERE id = 'u-1'")
      .get() as Record<string, unknown>;
    expect(row.slug).toBe("orphan-work");
    expect(row.repo).toBeNull();
    db.close();
  });

  test("renames a slug two projects both used, first-imported keeps it", () => {
    const db = target();
    expect(
      (db.query("SELECT slug FROM sessions WHERE id = 'b-1'").get() as { slug: string }).slug,
    ).toBe("finish-up");
    expect(
      (db.query("SELECT slug FROM sessions WHERE id = 'd-1'").get() as { slug: string }).slug,
    ).toBe("finish-up-2");
    db.close();
  });

  test("records no unreachable alias for the surrendered name", () => {
    // `finish-up` is another session's live slug and resolveSessionByName
    // tries slugs first, so an alias here could never be reached.
    const db = target();
    expect(
      db.query("SELECT 1 FROM session_aliases WHERE alias = 'finish-up'").get(),
    ).toBeNull();
    // The genuinely retired names still come across.
    expect(
      db.query("SELECT session_id FROM session_aliases WHERE alias = 'legacy/finish-up'").get(),
    ).toEqual({ session_id: "b-1" });
    db.close();
  });

  test("collapses a label both projects declared into one row", () => {
    const db = target();
    expect(one<{ n: number }>(db, "SELECT count(*) n FROM labels WHERE name = 'urgent'").n).toBe(1);
    expect(one<{ n: number }>(db, "SELECT count(*) n FROM session_labels").n).toBe(3);
    db.close();
  });

  test("leaves the source databases untouched", () => {
    // The installed build may still be reading them, so they must not be
    // migrated, rewritten or removed.
    const source = new Database(join(root, "projects", "bertrand", "bertrand.db"));
    const cols = (source.query("PRAGMA table_info(sessions)").all() as { name: string }[])
      .map((c) => c.name);
    expect(cols).toContain("name");
    expect(cols).toContain("rating");
    expect(cols).not.toContain("repo");
    source.close();
  });

  test("re-running imports nothing and duplicates nothing", () => {
    const { projects } = runConsolidateProjects();

    expect(projects.reduce((n, p) => n + p.sessions, 0)).toBe(0);
    expect(projects.reduce((n, p) => n + p.alreadyPresent, 0)).toBe(5);

    const db = target();
    expect(one<{ n: number }>(db, "SELECT count(*) n FROM sessions").n).toBe(5);
    expect(one<{ n: number }>(db, "SELECT count(*) n FROM events").n).toBe(10);
    db.close();
  });
});
