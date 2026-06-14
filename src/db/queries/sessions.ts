import { eq, and, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { sessions, categories } from "@/db/schema";
import { createId } from "@/lib/id";
import type { SessionRow, SessionStatus, SessionWithCategory } from "@/types";

export type { SessionStatus };

export function createSession(opts: {
  categoryId: string;
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

export function getSession(id: string): SessionRow | undefined {
  return getDb().select().from(sessions).where(eq(sessions.id, id)).get();
}

export function getSessionByCategorySlug(
  categoryId: string,
  slug: string,
): SessionRow | undefined {
  return getDb()
    .select()
    .from(sessions)
    .where(and(eq(sessions.categoryId, categoryId), eq(sessions.slug, slug)))
    .get();
}

export function getSessionsByCategory(categoryId: string): SessionRow[] {
  return getDb()
    .select()
    .from(sessions)
    .where(eq(sessions.categoryId, categoryId))
    .all();
}

export function getActiveSessions(): SessionWithCategory[] {
  return getDb()
    .select({ session: sessions, categoryPath: categories.path })
    .from(sessions)
    .innerJoin(categories, eq(sessions.categoryId, categories.id))
    .where(inArray(sessions.status, ["active", "waiting"]))
    .all();
}

export function getAllSessions(opts?: {
  excludeArchived?: boolean;
}): SessionWithCategory[] {
  const db = getDb();
  const query = db
    .select({ session: sessions, categoryPath: categories.path })
    .from(sessions)
    .innerJoin(categories, eq(sessions.categoryId, categories.id));

  if (opts?.excludeArchived) {
    return query
      .where(
        inArray(sessions.status, [
          "active",
          "waiting",
          "paused",
        ])
      )
      .all();
  }

  return query.all();
}

export function updateSessionStatus(id: string, status: SessionStatus): SessionRow {
  return getDb()
    .update(sessions)
    .set({ status, updatedAt: sql`(datetime('now'))` })
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
    .set({ ...data, updatedAt: sql`(datetime('now'))` })
    .where(eq(sessions.id, id))
    .returning()
    .get();
}

export function renameSession(id: string, slug: string, name?: string) {
  return getDb()
    .update(sessions)
    .set({ slug, name: name ?? slug, updatedAt: sql`(datetime('now'))` })
    .where(eq(sessions.id, id))
    .returning()
    .get();
}

export function moveSession(id: string, categoryId: string) {
  return getDb()
    .update(sessions)
    .set({ categoryId, updatedAt: sql`(datetime('now'))` })
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
