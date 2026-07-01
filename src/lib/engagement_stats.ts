import { eq, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { conversations } from "@/db/schema";
import { getEventsByType } from "@/db/queries/events";
import type { EngagementStats } from "@/types";

export type { EngagementStats };

type PermissionDetail = { tool?: string; count?: number };

function aggregateToolUsage(
  sessionId: string,
  db: Db,
): Record<string, number> {
  const counts: Record<string, number> = {};

  // tool.applied (Edit/Write/MultiEdit) carries one tool name per permissions[] entry.
  const applied = getEventsByType(sessionId, "tool.applied", db);
  for (const ev of applied) {
    const meta = ev.meta as Record<string, unknown> | null;
    const permissions = (meta?.permissions ?? []) as PermissionDetail[];
    for (const p of permissions) {
      if (!p.tool) continue;
      counts[p.tool] = (counts[p.tool] ?? 0) + (p.count ?? 1);
    }
  }

  // tool.used covers every other tool call (auto-approved + prompted-then-approved).
  const used = getEventsByType(sessionId, "tool.used", db);
  for (const ev of used) {
    const meta = ev.meta as Record<string, unknown> | null;
    const tool = meta?.tool as string | undefined;
    if (!tool) continue;
    counts[tool] = (counts[tool] ?? 0) + 1;
  }

  return counts;
}

function discardRate(sessionId: string, db: Db) {
  const row = db
    .select({
      total: sql<number>`count(*)`,
      discarded: sql<number>`sum(case when ${conversations.discarded} then 1 else 0 end)`,
    })
    .from(conversations)
    .where(eq(conversations.sessionId, sessionId))
    .get();
  return {
    total: row?.total ?? 0,
    discarded: row?.discarded ?? 0,
  };
}

export function computeEngagementStats(
  sessionId: string,
  db: Db = getDb(),
): EngagementStats {
  return {
    toolUsage: aggregateToolUsage(sessionId, db),
    discardRate: discardRate(sessionId, db),
  };
}
