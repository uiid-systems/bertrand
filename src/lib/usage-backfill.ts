/**
 * Repair conversation token totals from transcripts already on disk.
 *
 * Incremental ingestion (db/events/ingest.ts) only accrues tokens for lines it
 * reads, so every conversation whose transcript was ingested before usage
 * capture existed shows zero. This is the one job the cursor cannot do: a
 * stateless re-read of what was already consumed.
 *
 * The critical constraint is the cursor itself. Scoring a whole file would
 * double-count the moment ingestion next runs, because it resumes from its
 * offset and increments. So each transcript is scored only up to its cursor,
 * and the un-ingested tail is left for the cursor to pick up normally. That
 * tail is small (~2% of bytes in practice) and self-heals if the session is
 * ever resumed.
 *
 * Transcripts are located by scanning ~/.claude/projects rather than derived
 * from a session's cwd: a session that ran outside the main checkout writes
 * under a different project slug than its repo path.
 */

import { existsSync, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { ingestCursors } from "@/db/schema";
import {
  getAllConversations,
  setConversationUsage,
} from "@/db/queries/conversations";

import { summarizeTranscript } from "./transcript";

const JSONL = ".jsonl";

export interface UsageBackfillResult {
  /** Conversations whose totals were written. */
  scored: number;
  /** No transcript on disk — nothing to score. */
  noTranscript: number;
  /** Never ingested, so there is no consumed region yet; ingestion will accrue it. */
  notIngested: number;
}

/** conversationId → transcript path, in one pass over every project dir. */
export function buildTranscriptIndex(): Map<string, string> {
  const root = join(homedir(), ".claude", "projects");
  const index = new Map<string, string>();
  if (!existsSync(root)) return index;

  for (const dir of readdirSync(root)) {
    const dirPath = join(root, dir);
    let entries: string[];
    try {
      entries = readdirSync(dirPath);
    } catch {
      continue; // not a directory, or unreadable
    }
    for (const file of entries) {
      if (!file.endsWith(JSONL)) continue;
      const id = file.slice(0, -JSONL.length);
      // A conversation id maps to exactly one transcript; first match wins.
      if (!index.has(id)) index.set(id, join(dirPath, file));
    }
  }
  return index;
}

export function backfillConversationUsage(): UsageBackfillResult {
  const index = buildTranscriptIndex();
  const result: UsageBackfillResult = {
    scored: 0,
    noTranscript: 0,
    notIngested: 0,
  };

  for (const conversation of getAllConversations()) {
    const path = index.get(conversation.id);
    if (!path) {
      result.noTranscript++;
      continue;
    }

    const cursor = getDb()
      .select()
      .from(ingestCursors)
      .where(eq(ingestCursors.transcriptPath, path))
      .get();

    // Nothing consumed yet — leave it to ingestion, which will accrue the
    // whole file from byte 0 and would double-count anything written here.
    const offset = cursor?.offset ?? 0;
    if (offset <= 0) {
      result.notIngested++;
      continue;
    }

    const summary = summarizeTranscript(path, offset);
    if (!summary) {
      result.noTranscript++;
      continue;
    }

    setConversationUsage(conversation.id, {
      model: summary.model || null,
      inputTokens: summary.totalInputTokens,
      outputTokens: summary.totalOutputTokens,
      cacheCreationTokens: summary.totalCacheCreationTokens,
      cacheReadTokens: summary.totalCacheReadTokens,
    });
    result.scored++;
  }

  return result;
}
