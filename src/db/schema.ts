import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// Cross-cutting tags — "code-review", "frontend", "planning"
export const labels = sqliteTable("labels", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  color: text("color"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// Sessions are flat: the slug alone is a session's identity, unique across the
// one database (ELKY-171 — it said "per project DB" while there was more than
// one). Names retired by the flattening — and by manual renames — keep
// resolving via `session_aliases`.
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    // Who chose this session's name. Pause-time slug derivation (ELKY-168)
    // only ever renames 'derived' rows — a manual name is the user's word and
    // wins permanently. Defaults 'manual' because every creation path today is
    // a human-typed name; auto-created rows flip this when launch naming goes
    // automatic.
    nameSource: text("name_source", { enum: ["manual", "derived"] })
      .notNull()
      .default("manual"),
    status: text("status", {
      enum: ["active", "waiting", "blocked", "paused", "archived"],
    })
      .notNull()
      .default("paused"),
    summary: text("summary"),
    pid: integer("pid"),
    // Epoch ms when `pid` was recorded, so a recycled pid can't pass as the
    // original process (#209). Null on rows written before this existed —
    // identity then degrades to a bare liveness probe. Distinct from
    // `startedAt`, which is the session's lifetime, not this process's.
    pidStartedAt: integer("pid_started_at"),
    startedAt: text("started_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    endedAt: text("ended_at"),
    // The git branch this session is running on, read from its cwd at start
    // (and re-read on resume, since a session can come back on a different
    // branch). Null when the cwd is not in a repo, does not exist, or HEAD is
    // detached — bertrand logs non-repo sessions, so null is a normal value and
    // not an error state.
    //
    // Deliberately not named `worktree_*`. The only branch bertrand ever
    // recorded came from worktrees, which reached ~6% of sessions; this is the
    // branch every session already had and nobody was writing down.
    branch: text("branch"),
    // The next four columns are one record: the `SessionKey` that
    // `@/lib/session-key` derives from the session's cwd at start, persisted
    // verbatim, plus the `groupKey()` computed from it. They replace the
    // project registry as bertrand's grouping dimension — a project was a row
    // a human created, bound to a repo, and had to remember to switch to, and
    // getting any of that wrong filed a session under the wrong name with no
    // error and no symptom. Reading the answer out of `git` instead means
    // nothing registers a group, so nothing can be filed wrong.
    //
    // Derivation costs up to four `git` invocations, and hook subprocesses are
    // one-shot with no shared cache, so the values are written once at session
    // start and read from here forever after. Every one of them is nullable and
    // null is ordinary rather than an error state: bertrand records sessions in
    // directories that are not repos and must keep doing so, so an unresolvable
    // cwd yields a session with all four null — ungrouped, but recorded.
    //
    /**
     * Absolute path to the git worktree root holding the session's cwd — the
     * *linked* worktree when there is one, not the main checkout. Kept for
     * display and for `--resume`, not as the group's identity: see `groupKey`
     * below for why a path cannot be the identity.
     */
    worktreeRoot: text("worktree_root"),
    /**
     * Absolute path to the repo's main checkout, from `--git-common-dir`.
     * Equal to `worktreeRoot` when the session ran in the main checkout
     * itself, which is precisely the case that makes `worktreeRoot` alone
     * useless as an identity — the main checkout is a workbench hosting months
     * of unrelated work on many branches.
     */
    mainCheckout: text("main_checkout"),
    /**
     * Portable repo identity as `owner/repo` (`host/owner/repo` for GHES),
     * parsed from `origin`. This is the rollup axis the sidebar groups by, and
     * it is machine-independent on purpose: a main checkout and a stack of
     * linked worktrees are all one repo, and no human has to say so.
     *
     * Null when the cwd is not a repo, has no `origin`, or names a forge
     * bertrand cannot parse. Such a session still records; it just does not
     * roll up.
     */
    repo: text("repo"),
    /**
     * The unit of work this session *is* — `<repo>@<branch>`, falling back to
     * `path:<worktreeRoot>`. Repeated claude runs on one task resolve to the
     * same key and so become conversations of one session, instead of each
     * minting a session of its own.
     *
     * It is `(repo, branch)` and deliberately NOT a worktree path, because the
     * group has to outlive the directory. An Orca workspace is deleted the
     * moment its task lands, and a session keyed on that path would lose its
     * identity as the directory went away — including for a `--resume` run from
     * somewhere else afterwards. `(repo, branch)` survives the teardown, a
     * rebase, and a move between checkouts. The `path:` fallback only carries
     * repos whose `origin` could not be parsed, and its prefix keeps the two
     * key spaces from ever colliding.
     */
    groupKey: text("group_key"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex("sessions_slug").on(t.slug),
    index("sessions_status").on(t.status),
    index("sessions_started").on(t.startedAt),
    // Not unique: one unit of work legitimately holds several rows over time,
    // because archiving a session is how the user says "this task is done" and
    // a later run on the same branch then deserves a fresh one. Uniqueness
    // lives in the query (`findOpenSessionByGroupKey`), which takes the most
    // recently updated non-archived row.
    index("sessions_group_key").on(t.groupKey),
    // The rollup axis: the sidebar's top level is "sessions of repo X".
    index("sessions_repo").on(t.repo),
  ]
);

// Retired canonical names that must keep resolving. A manual rename
// (`bertrand rename`, ELKY-170) records the old slug here before it changes,
// and the category-flattening migration (ELKY-171) bulk-recorded every
// pre-flatten "<categoryPath>/<slug>" name, so every previously-typed name
// still reaches its session. The alias is the primary key — one name can only
// ever mean one session.
export const sessionAliases = sqliteTable("session_aliases", {
  alias: text("alias").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// Many-to-many: sessions ↔ labels
export const sessionLabels = sqliteTable(
  "session_labels",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    labelId: text("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("sl_pk").on(t.sessionId, t.labelId),
    index("sl_label").on(t.labelId),
  ]
);

// Each Claude conversation within a session
export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(), // claude_id UUID
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    startedAt: text("started_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    endedAt: text("ended_at"),
    discarded: integer("discarded", { mode: "boolean" })
      .notNull()
      .default(false),
    eventCount: integer("event_count").notNull().default(0),
    // Token usage, accumulated forward by transcript ingestion. Stored raw
    // (never as a dollar figure) — prices change, so cost is derived at
    // display time from `model` plus whatever rate card is current.
    model: text("model"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheCreationTokens: integer("cache_creation_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  },
  (t) => [index("conv_session").on(t.sessionId)]
);

// Timeline events
export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").references(
      () => conversations.id
    ),
    event: text("event").notNull(),
    summary: text("summary"),
    meta: text("meta", { mode: "json" }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    index("ev_session").on(t.sessionId),
    index("ev_session_event").on(t.sessionId, t.event),
    index("ev_event_created").on(t.event, t.createdAt),
    index("ev_conversation").on(t.conversationId),
  ]
);

// Transcript ingestion bookmarks — one per transcript file. Keyed by path
// rather than conversation id: a transcript is machine-local state, and a
// nested session can inherit BERTRAND_CLAUDE_ID while writing a different
// file. The pending counters carry thinking blocks seen since the last text
// event so they attach to the next narration (or flush as a "thinking only"
// event at turn end).
export const ingestCursors = sqliteTable("ingest_cursors", {
  transcriptPath: text("transcript_path").primaryKey(),
  offset: integer("offset").notNull().default(0),
  lastUuid: text("last_uuid"),
  // message.id of the last usage-bearing entry, so a message whose content
  // blocks straddle a tick boundary is not billed twice (see ingest.ts).
  lastUsageId: text("last_usage_id"),
  pendingThinkingBlocks: integer("pending_thinking_blocks")
    .notNull()
    .default(0),
  pendingThinkingBytes: integer("pending_thinking_bytes").notNull().default(0),
  pendingUuid: text("pending_uuid"),
  pendingTimestamp: text("pending_timestamp"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// Materialized stats — updated at session end, avoids full event scan
export const sessionStats = sqliteTable("session_stats", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => sessions.id, { onDelete: "cascade" }),
  eventCount: integer("event_count").notNull().default(0),
  conversationCount: integer("conversation_count").notNull().default(0),
  interactionCount: integer("interaction_count").notNull().default(0),
  claudeWorkS: integer("claude_work_s").notNull().default(0),
  userWaitS: integer("user_wait_s").notNull().default(0),
  activePct: integer("active_pct").notNull().default(0),
  durationS: integer("duration_s").notNull().default(0),
  // Rolled up from the session's conversations. Kept as four separate
  // counters, never a single total: cache reads run ~100x output volume but
  // bill at a fraction of it, so any sum of these is meaningless.
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cacheCreationTokens: integer("cache_creation_tokens").notNull().default(0),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  linesAdded: integer("lines_added").notNull().default(0),
  linesRemoved: integer("lines_removed").notNull().default(0),
  filesTouched: integer("files_touched").notNull().default(0),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});
