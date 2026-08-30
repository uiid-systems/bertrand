import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// Nestable containers — any depth, purpose-agnostic
export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    parentId: text("parent_id").references((): any => categories.id, {
      onDelete: "cascade",
    }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    path: text("path").notNull(),
    depth: integer("depth").notNull().default(0),
    color: text("color"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex("categories_parent_slug").on(t.parentId, t.slug),
    index("categories_path").on(t.path),
  ]
);

// Cross-cutting tags — "code-review", "frontend", "planning"
export const labels = sqliteTable("labels", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  color: text("color"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// Sessions belong to a category at any depth
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    status: text("status", {
      enum: ["active", "waiting", "blocked", "paused", "archived"],
    })
      .notNull()
      .default("paused"),
    summary: text("summary"),
    rating: integer("rating"),
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
    // Retired with the worktree teardown (ELKY-163): nothing writes either
    // column any more, so every row carrying one is history. They are not
    // equally dead, and the difference is what a later drop migration has to
    // respect.
    //
    // `worktree_path` is still *read*, in two places, and dropping it means
    // retiring both first:
    //   - `resolveSessionCwd` (engine/dashboard-session.ts) consults it only to
    //     refuse a resume when it disagrees with the last `claude.started` cwd.
    //     Those rows would otherwise resume isolated work in the main checkout
    //     — see the rationale there, and the guards in dashboard-resume.test.ts.
    //   - `migrate-repo.ts` scans it when ranking candidate repo paths.
    //
    // `worktree_branch` has no reader left and is the one genuinely safe to
    // drop today. It was also the only branch source bertrand ever had, which
    // is what `branch` above replaces.
    worktreePath: text("worktree_path"),
    worktreeBranch: text("worktree_branch"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex("sessions_category_slug").on(t.categoryId, t.slug),
    index("sessions_status").on(t.status),
    index("sessions_started").on(t.startedAt),
  ]
);

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
  // Where the three counters above came from. `events` replays `tool.applied`
  // and is recomputable forever; `git` is a snapshot taken while the session's
  // worktree still existed and is **not** — once the worktree is removed there
  // is nothing left to measure. The column exists so the event path can tell
  // the two apart and refuse to overwrite a git snapshot with a replay, which
  // would silently downgrade a completed session's numbers.
  diffSource: text("diff_source")
    .$type<"events" | "git">()
    .notNull()
    .default("events"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});
