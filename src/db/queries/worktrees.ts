import { eq, and } from "drizzle-orm";
import { getDb } from "../client.ts";
import { worktreeAssociations } from "../schema.ts";
import { createId } from "../../lib/id.ts";

export function createWorktreeAssociation(opts: {
  sessionId: string;
  branch: string;
  worktreePath?: string;
}) {
  return getDb()
    .insert(worktreeAssociations)
    .values({ id: createId(), ...opts })
    .returning()
    .get();
}

export function getActiveWorktree(sessionId: string) {
  return getDb()
    .select()
    .from(worktreeAssociations)
    .where(
      and(
        eq(worktreeAssociations.sessionId, sessionId),
        eq(worktreeAssociations.active, true)
      )
    )
    .get();
}

export function getWorktreesBySession(sessionId: string) {
  return getDb()
    .select()
    .from(worktreeAssociations)
    .where(eq(worktreeAssociations.sessionId, sessionId))
    .all();
}

export function getAllActiveWorktrees() {
  return getDb()
    .select()
    .from(worktreeAssociations)
    .where(eq(worktreeAssociations.active, true))
    .all();
}

export function exitWorktree(id: string) {
  return getDb()
    .update(worktreeAssociations)
    .set({ active: false, exitedAt: new Date().toISOString() })
    .where(eq(worktreeAssociations.id, id))
    .returning()
    .get();
}
