import {
  getSession,
  getAllSessions,
  updateSessionStatus,
} from "@/db/queries/sessions";
import { teardownWorkspace } from "@/lib/workspace";
import type { Db } from "@/db/client";
import type {
  SessionRow,
  ArchiveReason,
  UnarchiveReason,
} from "@/types";

export type { SessionRow, ArchiveReason, UnarchiveReason };

export type ArchiveResult =
  | { ok: true; session: SessionRow }
  | { ok: false; reason: ArchiveReason };

export type UnarchiveResult =
  | { ok: true; session: SessionRow }
  | { ok: false; reason: UnarchiveReason };

const ACTIVE_STATUSES = ["active", "waiting", "blocked"] as const;

export function archiveSession(id: string, db?: Db): ArchiveResult {
  const session = getSession(id, db);
  if (!session) return { ok: false, reason: "not-found" };

  if ((ACTIVE_STATUSES as readonly string[]).includes(session.status)) {
    return { ok: false, reason: "active" };
  }
  if (session.status === "archived") {
    return { ok: false, reason: "already-archived" };
  }

  const updated = updateSessionStatus(id, "archived", db);
  // An archived session's workspace ends with it: stop the dev server, run
  // the repo's archive script, release the port. Fire-and-forget — teardown
  // is best-effort and must not delay or fail the archive itself.
  void teardownWorkspace({
    sessionId: updated.id,
    worktreePath: updated.worktreePath,
    slug: updated.slug,
  });
  return { ok: true, session: updated };
}

export function unarchiveSession(id: string, db?: Db): UnarchiveResult {
  const session = getSession(id, db);
  if (!session) return { ok: false, reason: "not-found" };
  if (session.status !== "archived") {
    return { ok: false, reason: "not-archived" };
  }

  const updated = updateSessionStatus(id, "paused", db);
  return { ok: true, session: updated };
}

export type ArchivedRow = { session: SessionRow; categoryPath: string };

export function archiveAllPaused(): { archived: ArchivedRow[] } {
  const rows = getAllSessions({ excludeArchived: true });
  const paused = rows.filter((r) => r.session.status === "paused");

  const archived: ArchivedRow[] = [];
  for (const row of paused) {
    const updated = updateSessionStatus(row.session.id, "archived");
    void teardownWorkspace({
      sessionId: updated.id,
      worktreePath: updated.worktreePath,
      slug: updated.slug,
    });
    archived.push({ session: updated, categoryPath: row.categoryPath });
  }
  return { archived };
}
