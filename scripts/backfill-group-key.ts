/**
 * Backfill the derived grouping columns (`worktree_root`, `main_checkout`,
 * `repo`, `group_key`) on sessions that predate them.
 *
 *   bun scripts/backfill-group-key.ts                 # dry-run, real DB
 *   bun scripts/backfill-group-key.ts --db <path>     # dry-run, any DB copy
 *   bun scripts/backfill-group-key.ts --apply         # write the columns
 *   bun scripts/backfill-group-key.ts --apply --force # …including rows already keyed
 *
 * Why this exists: the columns are written at session start from the session's
 * cwd, and rows created before that code landed have no cwd to hand. This
 * recovers it from the session's own timeline — the `claude.started` event
 * records `cwd` in its meta — and re-derives the key from `git` exactly the way
 * a live session would.
 *
 * It matters more than a cosmetic backfill: `findOpenSessionByGroupKey` is what
 * makes a second claude run on one task attach to the existing session instead
 * of minting another. A surviving row with a null `group_key` can never be
 * found that way, so the first post-cutover run on each of those tasks would
 * fork a new session and the split-timeline problem this whole change exists to
 * fix would reappear once, per task, on day one.
 *
 * A session whose worktree has since been deleted has no directory left to ask,
 * and on this corpus that is the common case rather than the exception — Orca
 * removes a workspace when its task lands, so most recent sessions point at a
 * path that is already gone. Such a row still carries the `branch` it ran on,
 * though, and a branch is a git fact that outlives the worktree: the second
 * pass looks the branch up in every main checkout the first pass discovered and
 * takes the answer when exactly one repo has it.
 *
 * That is deliberately a *branch* lookup and not a path one. Inferring a repo
 * from the shape of a path is the prefix-matching approach
 * `docs/session-identity.md` Q4 rejected on measured evidence, and it is wrong
 * for precisely the linked worktrees that dominate here. Asking `git` which
 * repo contains a ref is the same class of question as the rest of this module.
 *
 * A branch several repos share — `main`, above all — stays ambiguous and is
 * left null rather than assigned to a coin flip.
 *
 * Dry-run is the default and writes nothing. Note the DB is migrated on open,
 * so even a dry-run touches the file's schema — point --db at a copy when
 * inspecting real data.
 */

import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { existsSync } from "fs";
import { join } from "path";
import { paths } from "../src/lib/paths";
import { deriveSessionKey, groupKey } from "../src/lib/session-key";
import * as schema from "../src/db/schema";

function parseArgs(argv: string[]) {
  const args = { db: "", apply: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--db") args.db = argv[++i] ?? "";
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--force") args.force = true;
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const dbPath = args.db || paths.db;

if (!existsSync(dbPath)) {
  console.error(`No database at ${dbPath}`);
  process.exit(1);
}

const sqlite = new Database(dbPath);
sqlite.exec("PRAGMA foreign_keys = ON");
migrate(drizzle(sqlite), {
  migrationsFolder: join(import.meta.dir, "..", "src", "db", "migrations"),
});

/**
 * Candidate rows, each with the cwd its first `claude.started` recorded.
 *
 * The *first* event, not the last: a session can be resumed in a different
 * directory, and the cwd a session was created in is the one its identity
 * should follow. Rows whose timeline has no `claude.started` at all (imported,
 * or created before that event existed) surface with a null cwd and are
 * reported as unrecoverable, which is what they are.
 */
const rows = sqlite
  .query<
    { id: string; slug: string; branch: string | null; group_key: string | null; cwd: string | null },
    []
  >(
    `SELECT s.id, s.slug, s.branch, s.group_key,
            (SELECT json_extract(e.meta, '$.cwd')
               FROM events e
              WHERE e.session_id = s.id AND e.event = 'claude.started'
              ORDER BY e.id LIMIT 1) AS cwd
       FROM sessions s
      ${args.force ? "" : "WHERE s.group_key IS NULL"}
      ORDER BY s.created_at`,
  )
  .all();

console.log(`${dbPath}\n${rows.length} session(s) to consider${args.apply ? "" : "  (dry run)"}\n`);

const update = sqlite.query(
  `UPDATE sessions
      SET worktree_root = ?, main_checkout = ?, repo = ?, group_key = ?, branch = COALESCE(?, branch)
    WHERE id = ?`,
);

let keyed = 0;

/**
 * Every main checkout the first pass resolved, mapped to its repo identity.
 * This is the second pass's entire universe of candidates — a repo bertrand has
 * never seen a session in cannot be the answer to anything here.
 */
const knownRepos = new Map<string, string>();

/** Rows the first pass could not key, held for the branch-lookup pass. */
const deferred: typeof rows = [];

for (const row of rows) {
  if (!row.cwd) {
    deferred.push(row);
    continue;
  }

  const key = await deriveSessionKey(row.cwd);
  const gk = groupKey(key);

  if (!gk) {
    deferred.push(row);
    continue;
  }

  if (key.mainCheckout && key.repo) knownRepos.set(key.mainCheckout, key.repo);

  console.log(`  ${row.slug.padEnd(38)} ${gk}`);
  if (args.apply) {
    update.run(key.worktreeRoot, key.mainCheckout, key.repo, gk, key.branch, row.id);
  }
  keyed++;
}

/**
 * Which of the known repos contain `branch`, by asking each one directly.
 *
 * Checks the local head *and* the remote-tracking ref, because on this corpus
 * the local head is usually gone: removing a worktree takes its branch with it,
 * so a landed task leaves `refs/remotes/origin/<branch>` as the only surviving
 * evidence that this repo is where the branch lived. Measured — every one of
 * the nine unkeyable rows had an origin ref and no local head.
 *
 * Always fully-qualified, never an abbreviation git might helpfully resolve to
 * a tag or to something in another namespace.
 */
async function reposContainingBranch(branch: string): Promise<[string, string][]> {
  const hits: [string, string][] = [];
  for (const [checkout, repo] of knownRepos) {
    const found = [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`].some(
      (ref) =>
        Bun.spawnSync({
          cmd: ["git", "-C", checkout, "rev-parse", "--verify", ref],
          stdout: "ignore",
          stderr: "ignore",
        }).exitCode === 0,
    );
    if (found) hits.push([checkout, repo]);
  }
  return hits;
}

let recovered = 0;
let unrecoverable = 0;

for (const row of deferred) {
  const why = !row.cwd
    ? "no recorded cwd"
    : existsSync(row.cwd)
      ? "not a git repo"
      : "worktree deleted";

  if (!row.branch) {
    console.log(`  ${row.slug.padEnd(38)} ${why}, no branch — left ungrouped`);
    unrecoverable++;
    continue;
  }

  const hits = await reposContainingBranch(row.branch);

  if (hits.length !== 1) {
    const detail = hits.length === 0 ? "branch not found in any known repo" : `branch in ${hits.length} repos`;
    console.log(`  ${row.slug.padEnd(38)} ${why}, ${detail} — left ungrouped`);
    unrecoverable++;
    continue;
  }

  const [checkout, repo] = hits[0]!;
  const gk = `${repo}@${row.branch}`;
  console.log(`  ${row.slug.padEnd(38)} ${gk}   (recovered via branch; ${why})`);
  // No `worktree_root`: the directory is gone and writing a path that does not
  // exist would be a lie that later code could act on. `main_checkout` is real.
  if (args.apply) {
    update.run(null, checkout, repo, gk, row.branch, row.id);
  }
  recovered++;
  keyed++;
}

console.log(
  `\n${keyed} keyed (${recovered} of them recovered via branch lookup), ` +
    `${unrecoverable} left ungrouped.` +
    (args.apply ? "" : "\nRe-run with --apply to write."),
);

// Report the groups this produces, since a backfill that keys every row
// *differently* has fixed nothing — the point is that tasks with more than one
// session collapse onto a shared key.
if (keyed > 0) {
  console.log("\nResulting groups:");
  for (const g of sqlite
    .query<{ group_key: string; n: number; slugs: string }, []>(
      `SELECT group_key, COUNT(*) AS n, group_concat(slug, ', ') AS slugs
         FROM sessions WHERE group_key IS NOT NULL
        GROUP BY group_key ORDER BY n DESC, group_key`,
    )
    .all()) {
    console.log(`  ${String(g.n).padStart(2)}  ${g.group_key}\n      ${g.slugs}`);
  }
}
