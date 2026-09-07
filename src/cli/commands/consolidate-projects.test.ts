import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import {
  cpSync,
  existsSync,
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
  sessions: {
    id: string;
    slug: string;
    branch: string | null;
    startedAt?: string;
  }[],
): void {
  const dir = join(root, "projects", slug);
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, "bertrand.db"));
  db.exec("PRAGMA foreign_keys = ON");
  migrate(drizzle(db), { migrationsFolder: legacyMigrationsFolder() });

  for (const s of sessions) {
    db.query(
      `INSERT INTO sessions (id, slug, name, status, branch, started_at)
       VALUES (?1, ?2, ?2, 'paused', ?3, ?4)`,
    ).run(s.id, s.slug, s.branch, s.startedAt ?? "2026-01-01 10:00:00");
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
    { id: "b-1", slug: "finish-up", branch: "elky-179", startedAt: "2026-03-01 10:00:00" },
    { id: "b-2", slug: "new-0dqjum", branch: "ui-182" },
  ]);
  // Same slug in a second project — legal there, a collision once merged.
  // Deliberately the OLDER of the two while sorting later by directory name,
  // so the test fails if collisions are settled by import order.
  seedProject("design-system", [
    { id: "d-1", slug: "finish-up", branch: "ui-500", startedAt: "2026-02-01 10:00:00" },
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
  test("a dry run reports the whole import and creates no database", () => {
    const { projects } = runConsolidateProjects({ dryRun: true });

    expect(projects.map((p) => p.slug).sort()).toEqual([
      "bertrand",
      "design-system",
      "unregistered",
    ]);
    expect(projects.reduce((n, p) => n + p.sessions, 0)).toBe(5);

    // Not merely "no rows" — the target file must not come into existence.
    // Collision detection has to query the merged database, so a preview that
    // ran against the real one would create and migrate it just by looking.
    expect(existsSync(paths.db)).toBe(false);
  });

  test("a dry run still previews cross-project slug collisions", () => {
    // The preview only sees `finish-up` as taken because its own copy of the
    // target records the first import; against an untouched database both
    // would preview as the bare slug while the real run renames one.
    const { projects } = runConsolidateProjects({ dryRun: true });
    const b = projects.find((p) => p.slug === "bertrand")!;
    expect(b.renamed).toEqual([{ from: "finish-up", to: "finish-up-2" }]);
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

  test("a contested slug goes to the oldest session, not the first imported", () => {
    // `design-system` imports after `bertrand` (directories sort that way) but
    // its finish-up started a month earlier, so it keeps the bare name. This is
    // migration 0018's rule; settling by import order would instead hand
    // contested names out alphabetically by project directory.
    const db = target();
    expect(
      (db.query("SELECT slug FROM sessions WHERE id = 'd-1'").get() as { slug: string }).slug,
    ).toBe("finish-up");
    expect(
      (db.query("SELECT slug FROM sessions WHERE id = 'b-1'").get() as { slug: string }).slug,
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
    ).not.toBeNull();
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
    expect(projects.reduce((n, p) => n + p.unchanged, 0)).toBe(5);
    expect(projects.reduce((n, p) => n + p.caughtUp, 0)).toBe(0);

    const db = target();
    expect(one<{ n: number }>(db, "SELECT count(*) n FROM sessions").n).toBe(5);
    expect(one<{ n: number }>(db, "SELECT count(*) n FROM events").n).toBe(10);
    db.close();
  });

  test("catches up a session that kept recording after it was imported", () => {
    // The first import is a snapshot. A session still running — the one doing
    // the consolidating, most of all — keeps writing to its project database,
    // and those events have to arrive on a later run rather than being skipped
    // along with the session.
    const source = new Database(join(root, "projects", "bertrand", "bertrand.db"));
    source.query(
      "INSERT INTO events (session_id, conversation_id, event, summary) VALUES ('b-1', 'b-1-conv', 'user.prompt', ?1)",
    ).run("recorded after the import");
    source.query(
      "UPDATE sessions SET status = 'archived', summary = 'wrapped up' WHERE id = 'b-1'",
    ).run();
    source.close();

    const { projects } = runConsolidateProjects();
    const bertrand = projects.find((p) => p.slug === "bertrand")!;

    expect(bertrand.caughtUp).toBe(1);
    expect(bertrand.sessions).toBe(0);

    const db = target();
    // Exactly the one new event, and no re-import of the original two.
    expect(one<{ n: number }>(db, "SELECT count(*) n FROM events WHERE session_id = 'b-1'").n).toBe(3);
    expect(
      one<{ n: number }>(db, "SELECT count(*) n FROM events WHERE summary = 'recorded after the import'").n,
    ).toBe(1);

    // Mutable columns follow the source; identity does not.
    const row = db.query("SELECT slug, status, summary FROM sessions WHERE id = 'b-1'").get() as Record<string, unknown>;
    expect(row.status).toBe("archived");
    expect(row.summary).toBe("wrapped up");
    // Renamed by the collision rule — a catch-up must not revert that.
    expect(row.slug).toBe("finish-up-2");
    db.close();
  });

  test("sees writes still sitting in a source's write-ahead log", () => {
    // bertrand runs its databases in WAL mode, so a source being written right
    // now keeps recent rows in a `-wal` sidecar until a checkpoint. Copying
    // just the main file would import a stale prefix — the case this was found
    // on had a 4MB WAL against a 1.1MB main file. The connection is left open
    // so nothing checkpoints it before the import reads it.
    const live = new Database(join(root, "projects", "unregistered", "bertrand.db"));
    live.exec("PRAGMA journal_mode = WAL");
    live.query(
      "INSERT INTO sessions (id, slug, name, status, started_at) VALUES ('w-1', 'wal-only', 'wal-only', 'paused', '2026-05-01 10:00:00')",
    ).run();
    live.query(
      "INSERT INTO events (session_id, event, summary) VALUES ('w-1', 'user.prompt', 'written into the wal')",
    ).run();

    try {
      runConsolidateProjects();

      const db = target();
      expect(
        db.query("SELECT slug FROM sessions WHERE id = 'w-1'").get(),
      ).toEqual({ slug: "wal-only" });
      expect(
        one<{ n: number }>(db, "SELECT count(*) n FROM events WHERE summary = 'written into the wal'").n,
      ).toBe(1);
      db.close();
    } finally {
      live.close();
    }
  });
});
