import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// Nestable containers — any depth, purpose-agnostic
export const groups = sqliteTable(
  "groups",
  {
    id: text("id").primaryKey(),
    parentId: text("parent_id").references((): any => groups.id, {
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
    uniqueIndex("groups_parent_slug").on(t.parentId, t.slug),
    index("groups_path").on(t.path),
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

// Sessions belong to a group at any depth
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    status: text("status", {
      enum: ["active", "waiting", "paused", "archived"],
    })
      .notNull()
      .default("paused"),
    summary: text("summary"),
    pid: integer("pid"),
    startedAt: text("started_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    endedAt: text("ended_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex("sessions_group_slug").on(t.groupId, t.slug),
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
    lastQuestion: text("last_question"),
    eventCount: integer("event_count").notNull().default(0),
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

// Worktree tracking
export const worktreeAssociations = sqliteTable(
  "worktree_associations",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    branch: text("branch").notNull(),
    worktreePath: text("worktree_path"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    enteredAt: text("entered_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    exitedAt: text("exited_at"),
  },
  (t) => [
    index("wt_session").on(t.sessionId),
    index("wt_active").on(t.active),
  ]
);

// Materialized stats — updated at session end, avoids full event scan
export const sessionStats = sqliteTable("session_stats", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => sessions.id, { onDelete: "cascade" }),
  eventCount: integer("event_count").notNull().default(0),
  conversationCount: integer("conversation_count").notNull().default(0),
  interactionCount: integer("interaction_count").notNull().default(0),
  prCount: integer("pr_count").notNull().default(0),
  claudeWorkS: integer("claude_work_s").notNull().default(0),
  userWaitS: integer("user_wait_s").notNull().default(0),
  activePct: integer("active_pct").notNull().default(0),
  durationS: integer("duration_s").notNull().default(0),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});
