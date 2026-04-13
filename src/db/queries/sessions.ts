import { eq, and, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { sessions, groups } from "@/db/schema";
import { createId } from "@/lib/id";

export type SessionStatus =
  | "working"
  | "blocked"
  | "prompting"
  | "paused"
  | "archived";

export function createSession(opts: {
  groupId: string;
  slug: string;
  name: string;
}) {
  const db = getDb();
  const id = createId();
  return db
    .insert(sessions)
    .values({ id, ...opts })
    .returning()
    .get();
}

export function getSession(id: string) {
  return getDb().select().from(sessions).where(eq(sessions.id, id)).get();
}

export function getSessionByGroupSlug(groupId: string, slug: string) {
  return getDb()
    .select()
    .from(sessions)
    .where(and(eq(sessions.groupId, groupId), eq(sessions.slug, slug)))
    .get();
}

export function getSessionsByGroup(groupId: string) {
  return getDb()
    .select()
    .from(sessions)
    .where(eq(sessions.groupId, groupId))
    .all();
}

export function getActiveSessions() {
  return getDb()
    .select({ session: sessions, groupPath: groups.path })
    .from(sessions)
    .innerJoin(groups, eq(sessions.groupId, groups.id))
    .where(inArray(sessions.status, ["working", "blocked", "prompting"]))
    .all();
}

export function getAllSessions(opts?: { excludeArchived?: boolean }) {
  const db = getDb();
  const query = db
    .select({ session: sessions, groupPath: groups.path })
    .from(sessions)
    .innerJoin(groups, eq(sessions.groupId, groups.id));

  if (opts?.excludeArchived) {
    return query
      .where(
        inArray(sessions.status, [
          "working",
          "blocked",
          "prompting",
          "paused",
        ])
      )
      .all();
  }

  return query.all();
}

export function updateSessionStatus(id: string, status: SessionStatus) {
  return getDb()
    .update(sessions)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(eq(sessions.id, id))
    .returning()
    .get();
}

export function updateSession(
  id: string,
  data: Partial<{
    status: SessionStatus;
    summary: string;
    pid: number | null;
    endedAt: string;
  }>
) {
  return getDb()
    .update(sessions)
    .set({ ...data, updatedAt: new Date().toISOString() })
    .where(eq(sessions.id, id))
    .returning()
    .get();
}

export function renameSession(id: string, slug: string, name?: string) {
  return getDb()
    .update(sessions)
    .set({ slug, name: name ?? slug, updatedAt: new Date().toISOString() })
    .where(eq(sessions.id, id))
    .returning()
    .get();
}

export function moveSession(id: string, groupId: string) {
  return getDb()
    .update(sessions)
    .set({ groupId, updatedAt: new Date().toISOString() })
    .where(eq(sessions.id, id))
    .returning()
    .get();
}

export function deleteSession(id: string) {
  return getDb()
    .delete(sessions)
    .where(eq(sessions.id, id))
    .run();
}
