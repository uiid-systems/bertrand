import { eq, and } from "drizzle-orm";
import { getDb } from "@/db/client";
import { labels, sessionLabels } from "@/db/schema";
import { createId } from "@/lib/id";

export function createLabel(opts: { name: string; color?: string }) {
  return getDb()
    .insert(labels)
    .values({ id: createId(), ...opts })
    .returning()
    .get();
}

export function getLabel(id: string) {
  return getDb().select().from(labels).where(eq(labels.id, id)).get();
}

export function getLabelByName(name: string) {
  return getDb().select().from(labels).where(eq(labels.name, name)).get();
}

export function getAllLabels() {
  return getDb().select().from(labels).all();
}

export function addLabelToSession(sessionId: string, labelId: string) {
  return getDb()
    .insert(sessionLabels)
    .values({ sessionId, labelId })
    .onConflictDoNothing()
    .returning()
    .get();
}

export function removeLabelFromSession(sessionId: string, labelId: string) {
  return getDb()
    .delete(sessionLabels)
    .where(
      and(eq(sessionLabels.sessionId, sessionId), eq(sessionLabels.labelId, labelId))
    );
}

export function getLabelsForSession(sessionId: string) {
  return getDb()
    .select({ label: labels })
    .from(sessionLabels)
    .innerJoin(labels, eq(sessionLabels.labelId, labels.id))
    .where(eq(sessionLabels.sessionId, sessionId))
    .all()
    .map((r) => r.label);
}
