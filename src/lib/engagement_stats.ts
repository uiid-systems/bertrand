import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { conversations } from "@/db/schema";
import { getEventsBySession, getEventsByType } from "@/db/queries/events";

export interface EngagementStats {
  toolUsage: Record<string, number>;
  contextTokens: { avg: number; max: number; latest: number };
  permissionDenials: number;
  discardRate: { discarded: number; total: number };
}

type PermissionDetail = { tool?: string; count?: number };

function aggregateToolUsage(sessionId: string): Record<string, number> {
  const counts: Record<string, number> = {};

  const applied = getEventsByType(sessionId, "tool.applied");
  for (const ev of applied) {
    const meta = ev.meta as Record<string, unknown> | null;
    const permissions = (meta?.permissions ?? []) as PermissionDetail[];
    for (const p of permissions) {
      if (!p.tool) continue;
      counts[p.tool] = (counts[p.tool] ?? 0) + (p.count ?? 1);
    }
  }

  const resolves = getEventsByType(sessionId, "permission.resolve");
  for (const ev of resolves) {
    const meta = ev.meta as Record<string, unknown> | null;
    const tool = meta?.tool as string | undefined;
    if (!tool) continue;
    counts[tool] = (counts[tool] ?? 0) + 1;
  }

  return counts;
}

function contextTokenStats(sessionId: string) {
  const snapshots = getEventsByType(sessionId, "context.snapshot");
  const samples: number[] = [];

  for (const ev of snapshots) {
    const meta = ev.meta as Record<string, unknown> | null;
    const input = parseInt((meta?.input_tokens as string) ?? "0", 10);
    const cacheRead = parseInt((meta?.cache_read_tokens as string) ?? "0", 10);
    const total = (Number.isFinite(input) ? input : 0) + (Number.isFinite(cacheRead) ? cacheRead : 0);
    if (total > 0) samples.push(total);
  }

  if (samples.length === 0) return { avg: 0, max: 0, latest: 0 };

  const sum = samples.reduce((a, b) => a + b, 0);
  const avg = Math.round(sum / samples.length);
  const max = Math.max(...samples);
  const latest = samples[samples.length - 1] ?? 0;
  return { avg, max, latest };
}

function permissionDenialCount(sessionId: string): number {
  const all = getEventsBySession(sessionId);
  let requests = 0;
  let resolves = 0;
  for (const ev of all) {
    if (ev.event === "permission.request") requests++;
    else if (ev.event === "permission.resolve") resolves++;
  }
  return Math.max(0, requests - resolves);
}

function discardRate(sessionId: string) {
  const row = getDb()
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

export function computeEngagementStats(sessionId: string): EngagementStats {
  return {
    toolUsage: aggregateToolUsage(sessionId),
    contextTokens: contextTokenStats(sessionId),
    permissionDenials: permissionDenialCount(sessionId),
    discardRate: discardRate(sessionId),
  };
}
