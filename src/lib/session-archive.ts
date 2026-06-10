import {
  getSession,
  getAllSessions,
  updateSessionStatus,
} from "@/db/queries/sessions";
import type { sessions } from "@/db/schema";

export type SessionRow = typeof sessions.$inferSelect;

export type ArchiveReason = "not-found" | "active" | "already-archived";
export type UnarchiveReason = "not-found" | "not-archived";

export type ArchiveResult =
  | { ok: true; session: SessionRow }
  | { ok: false; reason: ArchiveReason };

export type UnarchiveResult =
  | { ok: true; session: SessionRow }
  | { ok: false; reason: UnarchiveReason };

const ACTIVE_STATUSES = ["active", "waiting"] as const;

export function archiveSession(id: string): ArchiveResult {
  const session = getSession(id);
  if (!session) return { ok: false, reason: "not-found" };

  if ((ACTIVE_STATUSES as readonly string[]).includes(session.status)) {
    return { ok: false, reason: "active" };
  }
  if (session.status === "archived") {
    return { ok: false, reason: "already-archived" };
  }

  const updated = updateSessionStatus(id, "archived");
  return { ok: true, session: updated };
}

export function unarchiveSession(id: string): UnarchiveResult {
  const session = getSession(id);
  if (!session) return { ok: false, reason: "not-found" };
  if (session.status !== "archived") {
    return { ok: false, reason: "not-archived" };
  }

  const updated = updateSessionStatus(id, "paused");
  return { ok: true, session: updated };
}

export type ArchivedRow = { session: SessionRow; groupPath: string };

export function archiveAllPaused(): { archived: ArchivedRow[] } {
  const rows = getAllSessions({ excludeArchived: true });
  const paused = rows.filter((r) => r.session.status === "paused");

  const archived: ArchivedRow[] = [];
  for (const row of paused) {
    const updated = updateSessionStatus(row.session.id, "archived");
    archived.push({ session: updated, groupPath: row.groupPath });
  }
  return { archived };
}
