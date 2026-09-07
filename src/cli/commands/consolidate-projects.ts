import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { register } from "@/cli/router";
import { paths, _getRootDir } from "@/lib/paths";

const MIGRATIONS_FOLDER = join(import.meta.dir, "..", "..", "db", "migrations");

export interface ConsolidatedProject {
  slug: string;
  /** `owner/repo` the project was bound to, or null when it had no binding. */
  repo: string | null;
  sessions: number;
  conversations: number;
  events: number;
  /** Sessions whose slug was already taken in the merged database. */
  renamed: { from: string; to: string }[];
  /** Sessions already present, so a re-run left them alone. */
  alreadyPresent: number;
}

export interface ConsolidateResult {
  projects: ConsolidatedProject[];
  /** Project directories holding no database. */
  empty: string[];
}

/** `~/.bertrand/projects.json` — the registry the per-project split used. */
interface ProjectRegistry {
  projects?: {
    slug: string;
    repo?: {
      path?: string;
      provider?: { owner?: string; repo?: string; host?: string };
    };
  }[];
}

/**
 * `owner/repo` (or `host/owner/repo`) for each registered project slug.
 *
 * The registry is the only place this mapping survives: a per-project database
 * records no repo of its own — that column did not exist yet — and the
 * directory name is a project slug the user chose, not a repo identity.
 * Without it every imported session would land in the sidebar's "Outside a
 * repo" bucket regardless of where it actually ran.
 */
function readRegistry(root: string): Map<string, { repo: string | null; path: string | null }> {
  const file = join(root, "projects.json");
  const out = new Map<string, { repo: string | null; path: string | null }>();
  if (!existsSync(file)) return out;

  let parsed: ProjectRegistry;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8")) as ProjectRegistry;
  } catch {
    // A malformed registry costs grouping, not the import.
    return out;
  }

  for (const p of parsed.projects ?? []) {
    const provider = p.repo?.provider;
    const repo =
      provider?.owner && provider?.repo
        ? [provider.host, provider.owner, provider.repo].filter(Boolean).join("/")
        : null;
    out.set(p.slug, { repo, path: p.repo?.path ?? null });
  }
  return out;
}

/**
 * The slug every incoming session will land on, keyed by session id.
 *
 * Decided for the whole import at once and ordered by `started_at`, so the
 * oldest session claiming a name keeps it — the rule migration 0018 used when
 * flattening made two sessions collide. Per-project resolution would instead
 * award contested names by directory order, which says nothing about the
 * sessions involved.
 *
 * Names already live in the target — its slugs and its aliases — are taken
 * before any of this starts: claiming one would either break the unique index
 * or shadow an alias that `resolveSessionByName` can no longer reach.
 */
function assignSlugs(
  db: Database,
  staged: { copyPath: string }[],
): Map<string, string> {
  const taken = new Set<string>();
  for (const r of db.query("SELECT slug AS name FROM sessions UNION SELECT alias AS name FROM session_aliases").all() as {
    name: string;
  }[]) {
    taken.add(r.name);
  }

  const incoming: { id: string; slug: string; startedAt: string }[] = [];
  for (const { copyPath } of staged) {
    const src = new Database(copyPath, { readonly: true });
    for (const row of src
      .query("SELECT id, slug, started_at AS startedAt FROM sessions")
      .all() as { id: string; slug: string; startedAt: string }[]) {
      incoming.push(row);
    }
    src.close();
  }

  // `id` breaks ties so the result is deterministic across runs.
  incoming.sort(
    (a, b) =>
      a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id),
  );

  const assigned = new Map<string, string>();
  for (const row of incoming) {
    let slug = row.slug;
    for (let n = 2; taken.has(slug); n++) slug = `${row.slug}-${n}`;
    taken.add(slug);
    assigned.set(row.id, slug);
  }
  return assigned;
}

/**
 * Merge every `~/.bertrand/projects/<slug>/bertrand.db` into the single
 * database at {@link paths.db} (ELKY-189).
 *
 * Projects were bertrand's grouping dimension and each owned a database.
 * Removing them (#296) collapsed the path back to one file, but nothing ever
 * moved the rows: an install that had split was left pointing at an empty
 * database with its whole history stranded in directories no code reads.
 *
 * Source databases are never opened for writing. Each is copied to a temp
 * file, migrated forward there — they sit at 0018, so they need the drop of
 * `rating`, the session-key columns and the drop of `name` — and merged from
 * the copy, so the running install keeps working off originals this never
 * touches. Nothing is deleted; removing the old directories is a separate,
 * human decision.
 *
 * Two things are deliberately *not* reconstructed:
 *
 *  - `worktreeRoot` stays null. The path a session actually ran in was never
 *    recorded, and the project's checkout path is not it — a guess here would
 *    be indistinguishable from a fact for anything reading the column later.
 *  - `groupKey` stays null, even though `repo` and `branch` are both known for
 *    many rows. The key is what makes a new claude run *attach to* an existing
 *    session, and reviving a months-old paused session because someone checked
 *    its branch out again is worse than starting a fresh one. These rows are
 *    history; they group in the sidebar by `repo` without being reopenable.
 *
 * Idempotent: a session already in the target by id is skipped whole.
 */
export function runConsolidateProjects(
  opts: { dryRun?: boolean } = {},
): ConsolidateResult {
  const root = _getRootDir();
  const projectsDir = join(root, "projects");
  const result: ConsolidateResult = { projects: [], empty: [] };
  if (!existsSync(projectsDir)) return result;

  const registry = readRegistry(root);
  const scratch = mkdtempSync(join(tmpdir(), "bertrand-consolidate-"));
  const dryRun = opts.dryRun === true;

  // A dry run works on a *copy* of the target, so the flag means what it says.
  // Collision detection has to query the merged database, and querying it means
  // bringing it to the current schema first — which on a fresh install means
  // creating it. Doing that to the real file would make --dry-run write, which
  // is precisely the thing a preview must not do.
  const targetPath = dryRun ? join(scratch, "target-preview.db") : paths.db;
  if (dryRun && existsSync(paths.db)) copyFileSync(paths.db, targetPath);

  const target = new Database(targetPath);
  target.exec(`PRAGMA journal_mode = ${dryRun ? "DELETE" : "WAL"}`);
  target.exec("PRAGMA foreign_keys = ON");
  migrate(drizzle(target), { migrationsFolder: MIGRATIONS_FOLDER });

  try {
    // Pass 1 — migrate every source onto a copy and read its session list.
    // Nothing is inserted yet, because who keeps a contested slug cannot be
    // decided one project at a time.
    const staged: {
      project: ConsolidatedProject;
      binding: { repo: string | null; path: string | null } | null;
      copyPath: string;
    }[] = [];

    for (const slug of readdirSync(projectsDir).sort()) {
      const sourcePath = join(projectsDir, slug, "bertrand.db");
      if (!existsSync(sourcePath)) {
        result.empty.push(slug);
        continue;
      }

      const binding = registry.get(slug) ?? null;

      // Work on a copy so the originals — which the installed build may still
      // be reading — are never migrated or written.
      const copyPath = join(scratch, `${slug}.db`);
      copyFileSync(sourcePath, copyPath);
      const source = new Database(copyPath);
      source.exec("PRAGMA journal_mode = DELETE");
      migrate(drizzle(source), { migrationsFolder: MIGRATIONS_FOLDER });
      source.close();

      staged.push({
        project: {
          slug,
          repo: binding?.repo ?? null,
          sessions: 0,
          conversations: 0,
          events: 0,
          renamed: [],
          alreadyPresent: 0,
        },
        binding,
        copyPath,
      });
    }

    // Pass 2 — settle contested slugs across every project at once, oldest
    // session first. Same rule as migration 0018 used when flattening
    // categories collided: the earliest `started_at` keeps the bare slug and
    // later claimants take -2, -3. Deciding by directory order instead would
    // hand the name to whichever project sorts first alphabetically, which is
    // arbitrary — and in this corpus handed it to an *archived* session over a
    // live one purely because "design-system" < "shuff-app".
    const assigned = assignSlugs(target, staged);

    // Pass 3 — insert, project by project, with the slugs already settled.
    for (const entry of staged) {
      target.exec(
        `ATTACH DATABASE '${entry.copyPath.replace(/'/g, "''")}' AS src`,
      );
      try {
        mergeOne(target, entry.project, entry.binding, assigned);
      } finally {
        target.exec("DETACH DATABASE src");
      }
      result.projects.push(entry.project);
    }
  } finally {
    target.close();
    rmSync(scratch, { recursive: true, force: true });
  }

  return result;
}

/** Copy one attached `src` database into the main one. */
function mergeOne(
  db: Database,
  project: ConsolidatedProject,
  binding: { repo: string | null; path: string | null } | null,
  assigned: Map<string, string>,
): void {
  const sessions = db
    .query("SELECT id, slug, branch FROM src.sessions ORDER BY started_at, id")
    .all() as { id: string; slug: string; branch: string | null }[];

  // Label ids are per-database, but a label is identified by its name, so the
  // same name in two projects must collapse to one row rather than duplicate.
  const labelIdByName = new Map<string, string>();
  for (const row of db.query("SELECT id, name FROM labels").all() as {
    id: string;
    name: string;
  }[]) {
    labelIdByName.set(row.name, row.id);
  }

  const run = (sql: string, ...params: unknown[]) => {
    db.query(sql).run(...(params as never[]));
  };

  for (const session of sessions) {
    if (db.query("SELECT 1 FROM sessions WHERE id = ?1").get(session.id) != null) {
      project.alreadyPresent++;
      continue;
    }

    const slug = assigned.get(session.id) ?? session.slug;
    if (slug !== session.slug) {
      project.renamed.push({ from: session.slug, to: slug });
    }

    run(
      `INSERT INTO sessions
         (id, slug, name_source, status, summary, pid, pid_started_at,
          started_at, ended_at, branch, worktree_root, main_checkout, repo,
          group_key, created_at, updated_at)
       SELECT id, ?2, name_source, status, summary, pid, pid_started_at,
              started_at, ended_at, branch, NULL, ?3, ?4, NULL,
              created_at, updated_at
         FROM src.sessions WHERE id = ?1`,
      session.id,
      slug,
      binding?.path ?? null,
      binding?.repo ?? null,
    );

    // Deliberately no alias for the name a renamed session gave up. It was
    // taken by another session's *slug* (or by an alias already pointing
    // elsewhere), and `resolveSessionByName` tries slugs first — so an alias
    // recorded here could never be reached, and would only look like the old
    // name still worked. Across two projects one name can mean one session,
    // and the first claimant keeps it.
    run(
      `INSERT OR IGNORE INTO session_aliases (alias, session_id)
       SELECT alias, session_id FROM src.session_aliases WHERE session_id = ?1`,
      session.id,
    );

    run(
      `INSERT OR IGNORE INTO conversations
       SELECT * FROM src.conversations WHERE session_id = ?1`,
      session.id,
    );

    // `events.id` is autoincrement and every source database numbered from 1,
    // so the column is dropped and the target reassigns. Ordering survives
    // because rows are inserted in their original (created_at, id) order and
    // readers sort by that pair.
    run(
      `INSERT INTO events (session_id, conversation_id, event, summary, meta, created_at)
       SELECT session_id, conversation_id, event, summary, meta, created_at
         FROM src.events WHERE session_id = ?1
        ORDER BY created_at, id`,
      session.id,
    );

    run(
      `INSERT OR IGNORE INTO session_stats
       SELECT * FROM src.session_stats WHERE session_id = ?1`,
      session.id,
    );

    for (const label of db
      .query("SELECT l.id, l.name, l.color FROM src.session_labels sl JOIN src.labels l ON l.id = sl.label_id WHERE sl.session_id = ?1")
      .all(session.id as never) as { id: string; name: string; color: string | null }[]) {
      let targetId = labelIdByName.get(label.name);
      if (!targetId) {
        targetId = label.id;
        run(
          "INSERT OR IGNORE INTO labels (id, name, color) VALUES (?1, ?2, ?3)",
          targetId,
          label.name,
          label.color,
        );
        labelIdByName.set(label.name, targetId);
      }
      run(
        "INSERT OR IGNORE INTO session_labels (session_id, label_id) VALUES (?1, ?2)",
        session.id,
        targetId,
      );
    }

    project.sessions++;
    project.conversations += (
      db.query("SELECT count(*) AS n FROM src.conversations WHERE session_id = ?1").get(session.id as never) as { n: number }
    ).n;
    project.events += (
      db.query("SELECT count(*) AS n FROM src.events WHERE session_id = ?1").get(session.id as never) as { n: number }
    ).n;
  }

  // Transcript ingestion offsets are keyed on an absolute path, so they are
  // machine-global rather than per-project. Carrying them over stops a merged
  // conversation's transcript being re-ingested from byte zero and double
  // counting its usage.
  run("INSERT OR IGNORE INTO ingest_cursors SELECT * FROM src.ingest_cursors");
}

register("consolidate-projects", async (args) => {
  const dryRun = args.includes("--dry-run");
  const { projects, empty } = runConsolidateProjects({ dryRun });

  if (projects.length === 0) {
    console.log("No per-project databases found — nothing to consolidate.");
    return;
  }

  const verb = dryRun ? "Would import" : "Imported";
  let total = 0;
  for (const p of projects) {
    total += p.sessions;
    const where = p.repo ? ` → ${p.repo}` : " (no repo binding, stays ungrouped)";
    console.log(
      `${verb} ${p.sessions} session(s), ${p.conversations} conversation(s), ${p.events} event(s) from ${p.slug}${where}`,
    );
    if (p.alreadyPresent) {
      console.log(`  ${p.alreadyPresent} already present, left alone`);
    }
    for (const r of p.renamed) {
      console.log(
        `  slug taken by another project: ${r.from} → ${r.to} (the bare name now means the other session)`,
      );
    }
  }
  if (empty.length) {
    console.log(`No database in: ${empty.join(", ")}`);
  }

  console.log(`\n${verb.replace("Would import", "Would import a total of")} ${total} session(s).`);
  if (dryRun) {
    console.log("Dry run — nothing was written. Re-run without --dry-run.");
  } else {
    console.log(
      "Source databases were not modified or deleted. Remove ~/.bertrand/projects once you have confirmed the import.",
    );
  }
});
