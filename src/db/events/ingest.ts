/**
 * Cursor-based transcript ingestion — the capture path for assistant output.
 *
 * A transcript is an append-only JSONL file. Each conversation keeps a
 * bookmark (`ingest_cursors` row keyed by transcript path): "ingested through
 * byte N". Every hook tick reads *forward* from the bookmark and emits one
 * assistant.message event per text-bearing assistant entry, so mid-turn
 * narration lands in the timeline in true order, interleaved with tool
 * events. This replaces the old turn-boundary capture (`assistant-message`),
 * which re-derived "the latest turn" at AskUserQuestion/Stop and could only
 * ever see the tail of it.
 *
 * Thinking blocks are signature-only on current models (no readable text),
 * so they accumulate as pending depth counters and attach to the next text
 * event. A turn that ends with trailing thinking and no text (e.g. thought →
 * AskUserQuestion) flushes as a "thinking only" event when the caller passes
 * `flush: true` — the AUQ and Stop hooks do; per-tool ticks don't, because
 * mid-turn there may still be text coming.
 *
 * Concurrency: parallel tool calls fire PostToolUse hooks in parallel, so
 * two bertrand processes can ingest the same file at once. The whole
 * read-cursor → emit → write-cursor cycle runs in a BEGIN IMMEDIATE
 * transaction; with busy_timeout the loser waits, then sees the advanced
 * cursor and ingests nothing. If the cursor ever points past EOF (file
 * replaced/truncated), it resets to zero and the uuids already recorded in
 * event meta absorb the re-read.
 */

import { closeSync, existsSync, openSync, readSync, statSync } from "fs";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { events, ingestCursors } from "@/db/schema";
import { contentBlocks } from "@/lib/transcript";
import { emitAssistantMessage } from "./emit";

const NEWLINE = 0x0a;

export interface IngestArgs {
  sessionId: string;
  conversationId?: string;
  transcriptPath: string;
  /** Emit trailing thinking as a "thinking only" event — turn-end ticks only. */
  flush?: boolean;
}

function summarize(text: string): string {
  const firstLine = text.split("\n").find((l) => l.trim()) ?? "";
  const trimmed = firstLine.trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
}

/** ISO timestamp → the `datetime('now')` format events sort by. */
function toSqliteTime(iso: unknown): string | undefined {
  if (typeof iso !== "string" || iso.length < 19) return undefined;
  return iso.replace("T", " ").slice(0, 19);
}

/** uuids of already-recorded messages — consulted only after a cursor reset. */
function loadSeenUuids(sessionId: string): Set<string> {
  const rows = getDb()
    .select({ uuid: sql<string | null>`json_extract(${events.meta}, '$.uuid')` })
    .from(events)
    .where(and(eq(events.sessionId, sessionId), eq(events.event, "assistant.message")))
    .all();
  return new Set(rows.map((r) => r.uuid).filter((u): u is string => !!u));
}

export function ingestTranscript(args: IngestArgs): { emitted: number } {
  const { sessionId, conversationId, transcriptPath, flush } = args;
  if (!existsSync(transcriptPath)) return { emitted: 0 };

  const db = getDb();
  return db.transaction(
    (tx) => {
      const cursor = tx
        .select()
        .from(ingestCursors)
        .where(eq(ingestCursors.transcriptPath, transcriptPath))
        .get();

      const size = statSync(transcriptPath).size;
      let offset = cursor?.offset ?? 0;

      // File replaced or truncated (rotation, compaction edge) — restart and
      // let uuid dedup absorb whatever was already recorded.
      let seen: Set<string> | null = null;
      if (offset > size) {
        offset = 0;
        seen = loadSeenUuids(sessionId);
      }

      let pendingBlocks = cursor?.pendingThinkingBlocks ?? 0;
      let pendingBytes = cursor?.pendingThinkingBytes ?? 0;
      let pendingUuid = cursor?.pendingUuid ?? null;
      let pendingTimestamp = cursor?.pendingTimestamp ?? null;
      let lastUuid = cursor?.lastUuid ?? null;
      let emitted = 0;
      let model = "";

      let newOffset = offset;
      if (size > offset) {
        const fd = openSync(transcriptPath, "r");
        const buf = Buffer.alloc(size - offset);
        try {
          readSync(fd, buf, 0, buf.length, offset);
        } finally {
          closeSync(fd);
        }

        // Only consume newline-terminated lines — the tail may still be
        // mid-write. The unterminated remainder is picked up next tick.
        const lastNewline = buf.lastIndexOf(NEWLINE);
        if (lastNewline >= 0) {
          newOffset = offset + lastNewline + 1;
          const lines = buf
            .subarray(0, lastNewline + 1)
            .toString("utf-8")
            .split("\n");

          for (const line of lines) {
            if (!line.trim()) continue;
            let entry: Record<string, unknown>;
            try {
              entry = JSON.parse(line);
            } catch {
              continue; // advance past garbage — it never parses better later
            }

            if (entry.type !== "assistant") continue;
            if (entry.isSidechain === true) continue; // subagent chatter

            const message = entry.message as Record<string, unknown> | undefined;
            if (typeof message?.model === "string") model = message.model;

            const uuid = typeof entry.uuid === "string" ? entry.uuid : null;
            const timestamp =
              typeof entry.timestamp === "string" ? entry.timestamp : null;
            if (uuid) lastUuid = uuid;

            const textParts: string[] = [];
            for (const block of contentBlocks(entry) ?? []) {
              if (block.type === "text" && typeof block.text === "string") {
                textParts.push(block.text);
              } else if (block.type === "thinking") {
                pendingBlocks++;
                if (typeof block.signature === "string") {
                  pendingBytes += block.signature.length;
                }
                pendingUuid = uuid ?? pendingUuid;
                pendingTimestamp = timestamp ?? pendingTimestamp;
              }
            }

            const text = textParts.join("\n\n").trim();
            if (!text) continue;

            if (!seen?.has(uuid ?? "")) {
              emitAssistantMessage({
                sessionId,
                conversationId,
                text,
                model,
                thinkingBlocks: pendingBlocks,
                thinkingBytes: pendingBytes,
                summary: summarize(text),
                uuid: uuid ?? undefined,
                timestamp: timestamp ?? undefined,
                createdAt: toSqliteTime(timestamp),
              });
              emitted++;
            }
            pendingBlocks = 0;
            pendingBytes = 0;
            pendingUuid = null;
            pendingTimestamp = null;
          }
        }
      }

      // Turn-end flush: thinking with no following text (e.g. thought → AUQ
      // call). Mid-turn ticks skip this — text may still be coming.
      if (flush && pendingBlocks > 0) {
        if (!seen?.has(pendingUuid ?? "")) {
          emitAssistantMessage({
            sessionId,
            conversationId,
            text: "",
            model,
            thinkingBlocks: pendingBlocks,
            thinkingBytes: pendingBytes,
            summary: "thinking only",
            uuid: pendingUuid ?? undefined,
            timestamp: pendingTimestamp ?? undefined,
            createdAt: toSqliteTime(pendingTimestamp),
          });
          emitted++;
        }
        pendingBlocks = 0;
        pendingBytes = 0;
        pendingUuid = null;
        pendingTimestamp = null;
      }

      tx.insert(ingestCursors)
        .values({
          transcriptPath,
          offset: newOffset,
          lastUuid,
          pendingThinkingBlocks: pendingBlocks,
          pendingThinkingBytes: pendingBytes,
          pendingUuid,
          pendingTimestamp,
          updatedAt: sql`(datetime('now'))`,
        })
        .onConflictDoUpdate({
          target: ingestCursors.transcriptPath,
          set: {
            offset: newOffset,
            lastUuid,
            pendingThinkingBlocks: pendingBlocks,
            pendingThinkingBytes: pendingBytes,
            pendingUuid,
            pendingTimestamp,
            updatedAt: sql`(datetime('now'))`,
          },
        })
        .run();

      return { emitted };
    },
    { behavior: "immediate" },
  );
}
