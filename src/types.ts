/**
 * Shared domain shapes. Import only from leaf type modules here — never from a
 * module that does I/O — so this stays cheap to reach from anywhere.
 */
import type { sessions, events, sessionStats } from "./db/schema";

export type SessionRow = typeof sessions.$inferSelect;
export type SessionStatus = SessionRow["status"];

export type EventRow = Omit<typeof events.$inferSelect, "meta"> & {
  meta: Record<string, unknown> | null;
};

export type SessionStatsRow = typeof sessionStats.$inferSelect;

/**
 * A session as every list query returns it.
 *
 * There is no sibling `project` field any more, and nothing replaced it: the
 * grouping dimension is now four columns *on the session itself* (`repo`,
 * `branch`, `groupKey`, `worktreeRoot`), derived from its cwd at start and
 * inferred into `SessionRow` straight from the schema. A client groups by
 * `row.session.repo` and needs no second request and no registry to join
 * against.
 *
 * The wrapper stays a wrapper rather than collapsing to `SessionRow`, because
 * endpoints do decorate it — and a one-field object is a cheaper place to add
 * the next decoration than a breaking change to every caller.
 */
export type SessionListRow = {
  session: SessionRow;
};

export type ArchiveReason = "not-found" | "active" | "already-archived";
export type UnarchiveReason = "not-found" | "not-archived";
