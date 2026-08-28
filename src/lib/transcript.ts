/**
 * JSONL transcript parser for Claude Code conversation files.
 *
 * Transcript files live at ~/.claude/projects/{path-hash}/{conversationId}.jsonl
 * and are append-only. Each line is a JSON object with a `type` discriminator.
 *
 * This module streams files line-by-line and extracts structured summaries
 * without holding the full content in memory.
 */

import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

// -- Types --

interface AssistantUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface TranscriptSummary {
  model: string;
  turnCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  toolUseCounts: Record<string, number>;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
}

export interface AssistantTurn {
  model: string;
  text: string;
  thinkingBlocks: number;
  thinkingBytes: number;
}

// -- Claude transcript path resolution --

/**
 * Resolve where Claude Code stores the transcript JSONL for a given
 * session ID. Claude derives the project directory from the CWD by
 * replacing each `/` with `-` and emitting that as a leading-dash slug.
 *
 * Pass `cwd` only for tests; production callers want `process.cwd()`.
 */
export function claudeTranscriptPath(sessionId: string, cwd?: string): string {
  const dir = (cwd ?? process.cwd()).replace(/\//g, "-");
  return join(homedir(), ".claude", "projects", dir, `${sessionId}.jsonl`);
}

/**
 * Read up to the first newline of `filePath` without loading the whole file.
 * Transcripts run to tens of megabytes; the identity marker we want sits on
 * the first line.
 */
function readFirstLine(filePath: string, maxBytes = 64 * 1024): string | null {
  let fd: number;
  try {
    fd = openSync(filePath, "r");
  } catch {
    return null;
  }
  try {
    const buf = Buffer.alloc(maxBytes);
    const read = readSync(fd, buf, 0, maxBytes, 0);
    if (read <= 0) return null;
    const chunk = buf.toString("utf-8", 0, read);
    const newline = chunk.indexOf("\n");
    // A first line longer than the window is not the short identity marker
    // we're looking for, so skip the file rather than parse a fragment.
    return newline === -1 ? null : chunk.slice(0, newline);
  } finally {
    closeSync(fd);
  }
}

/**
 * Locate the transcript JSONL for `sessionId` under `cwd`, or null when there
 * is none.
 *
 * The fast path is the derived `{sessionId}.jsonl` — how Claude has
 * historically named the file, and still the common case. That naming is no
 * longer guaranteed: recent Claude Code versions can write a transcript under
 * a UUID that differs from the session id the hooks report, so the derived
 * path misses. Every transcript entry carries its own `sessionId`, so when the
 * derived path is absent we scan the project directory and match on that.
 *
 * A false negative here is not cosmetic. `claudeSessionExists` feeds
 * `planResume`, where a miss silently downgrades a resume to `--session-id`
 * and hands the user a blank conversation wearing the old one's id.
 */
export function findClaudeTranscript(
  sessionId: string,
  cwd?: string,
): string | null {
  const derived = claudeTranscriptPath(sessionId, cwd);
  if (existsSync(derived)) return derived;

  let entries: string[];
  try {
    entries = readdirSync(dirname(derived));
  } catch {
    // No project directory: nothing has ever been written for this cwd.
    return null;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue;
    const candidate = join(dirname(derived), entry);
    if (candidate === derived) continue;
    const line = readFirstLine(candidate);
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as { sessionId?: unknown };
      if (parsed.sessionId === sessionId) return candidate;
    } catch {
      // Partially written or non-JSON first line — treat as no match.
    }
  }

  return null;
}

/**
 * True if Claude has a transcript for this session ID under the current
 * CWD. `claude --resume <id>` requires this; otherwise it exits with
 * "No conversation found with session ID: <id>" — bertrand's resume path
 * uses this check to fall back to `--session-id` when the transcript is
 * missing (fresh conversation, never-interacted session, CWD mismatch).
 *
 * Tolerates a transcript whose filename disagrees with the session id; see
 * `findClaudeTranscript`.
 */
export function claudeSessionExists(sessionId: string, cwd?: string): boolean {
  return findClaudeTranscript(sessionId, cwd) !== null;
}

// -- Parsing --

/**
 * Read the whole file, or only its first `maxBytes` truncated back to the
 * last complete line. Usage backfill passes the ingest cursor's offset so it
 * scores exactly the region incremental ingestion already consumed — the
 * remainder is left for the cursor to pick up, so nothing is counted twice.
 */
function readSlice(filePath: string, maxBytes?: number): string {
  if (maxBytes === undefined) return readFileSync(filePath, "utf-8");

  const length = Math.min(maxBytes, statSync(filePath).size);
  if (length <= 0) return "";

  const buf = Buffer.alloc(length);
  const fd = openSync(filePath, "r");
  try {
    readSync(fd, buf, 0, length, 0);
  } finally {
    closeSync(fd);
  }

  const lastNewline = buf.lastIndexOf(0x0a);
  return lastNewline >= 0 ? buf.subarray(0, lastNewline + 1).toString("utf-8") : "";
}

/**
 * Summarize a transcript file: total tokens, model, tool usage, turn count.
 * Pass `maxBytes` to summarize only a prefix of the file.
 */
export function summarizeTranscript(
  filePath: string,
  maxBytes?: number,
): TranscriptSummary | null {
  if (!existsSync(filePath)) return null;

  const text = readSlice(filePath, maxBytes);
  const summary: TranscriptSummary = {
    model: "",
    turnCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 0,
    toolUseCounts: {},
    firstTimestamp: null,
    lastTimestamp: null,
  };

  // Claude Code writes one entry per content block of an assistant message,
  // and every one carries a copy of that message's `usage`. Summing them all
  // inflates totals ~2-3x, so usage is counted once per message.id. Repeats
  // are always consecutive (blocks of a message are written in sequence), so
  // remembering the previous id is enough — no growing set.
  let lastUsageId: string | null = null;

  for (const line of text.split("\n")) {
    if (!line) continue;

    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    // Track timestamps from any entry that has one
    const ts = entry.timestamp as string | undefined;
    if (ts) {
      if (!summary.firstTimestamp) summary.firstTimestamp = ts;
      summary.lastTimestamp = ts;
    }

    if (entry.type !== "assistant") continue;

    const message = entry.message as Record<string, unknown> | undefined;
    if (!message) continue;

    // Model — take the latest (could change mid-session with /fast toggle).
    // Sidechain entries are excluded: a subagent may run a different model,
    // and the conversation's model is the main agent's. Their *usage* still
    // counts below, matching the incremental path in db/events/ingest.ts.
    if (message.model && entry.isSidechain !== true) {
      summary.model = message.model as string;
    }

    // Usage — once per message, not once per content-block entry.
    const usage = message.usage as Partial<AssistantUsage> | undefined;
    const messageId = typeof message.id === "string" ? message.id : null;
    if (usage && !(messageId !== null && messageId === lastUsageId)) {
      summary.turnCount++;
      summary.totalInputTokens += usage.input_tokens ?? 0;
      summary.totalOutputTokens += usage.output_tokens ?? 0;
      summary.totalCacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
      summary.totalCacheReadTokens += usage.cache_read_input_tokens ?? 0;
    }
    if (usage && messageId) lastUsageId = messageId;

    // Tool use counts
    const content = message.content as Array<Record<string, unknown>> | undefined;
    if (content) {
      for (const block of content) {
        if (block.type === "tool_use" && typeof block.name === "string") {
          summary.toolUseCounts[block.name] = (summary.toolUseCounts[block.name] ?? 0) + 1;
        }
      }
    }
  }

  return summary;
}

export function contentBlocks(
  entry: Record<string, unknown>,
): Array<Record<string, unknown>> | null {
  const message = entry.message as Record<string, unknown> | undefined;
  const content = message?.content;
  return Array.isArray(content)
    ? (content as Array<Record<string, unknown>>)
    : null;
}

/**
 * True when a `type:"user"` entry represents actual user input — the start of
 * a new turn. Claude Code writes every tool result back into the transcript
 * as a user entry too (in a tool-heavy conversation those outnumber real
 * prompts ~13:1), so mid-turn tool results must NOT count as boundaries. But
 * an answered AskUserQuestion is user input arriving *as* a tool_result, and
 * in bertrand's loop it is the usual turn boundary — hence the auqIds check.
 */
function isTurnBoundary(
  entry: Record<string, unknown>,
  auqIds: Set<string>,
): boolean {
  const blocks = contentBlocks(entry);
  if (!blocks) return true; // string content — a typed prompt
  const results = blocks.filter((b) => b.type === "tool_result");
  if (results.length === 0) return true; // text/attachment prompt
  return results.some((r) => auqIds.has(r.tool_use_id as string));
}

/**
 * Extract the latest assistant turn — all assistant entries since the most
 * recent user input (a typed prompt or an answered AskUserQuestion). Claude
 * Code splits a turn across multiple assistant entries (thinking is its own
 * entry, response is another) and interleaves tool results as `type:"user"`
 * entries mid-turn, so we skip those and aggregate everything back to the
 * last real boundary.
 *
 * Thinking blocks on Opus 4.7 are signature-only ({"thinking":"","signature":...})
 * — we surface the count and total signature byte size as a depth proxy.
 */
export function getLatestAssistantTurn(filePath: string): AssistantTurn | null {
  if (!existsSync(filePath)) return null;

  const text = readFileSync(filePath, "utf-8");
  const lines = text.split("\n");

  const entries: Record<string, unknown>[] = [];
  for (const line of lines) {
    if (!line) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      continue;
    }
  }

  // Forward pass: collect AskUserQuestion tool_use ids so their tool_results
  // can be recognized as turn boundaries in the backwards walk.
  const auqIds = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "assistant") continue;
    for (const block of contentBlocks(entry) ?? []) {
      if (
        block.type === "tool_use" &&
        block.name === "AskUserQuestion" &&
        typeof block.id === "string"
      ) {
        auqIds.add(block.id);
      }
    }
  }

  const assistantEntries: Record<string, unknown>[] = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!entry) continue;
    if (entry.type === "user" && isTurnBoundary(entry, auqIds)) break;
    if (entry.type === "assistant") assistantEntries.push(entry);
  }

  if (assistantEntries.length === 0) return null;

  assistantEntries.reverse();

  let model = "";
  const textParts: string[] = [];
  let thinkingBlocks = 0;
  let thinkingBytes = 0;

  for (const entry of assistantEntries) {
    const message = entry.message as Record<string, unknown> | undefined;
    if (!message) continue;
    if (message.model) model = message.model as string;

    const content = message.content as Array<Record<string, unknown>> | undefined;
    if (!content) continue;

    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string") {
        textParts.push(block.text);
      } else if (block.type === "thinking") {
        thinkingBlocks++;
        const sig = block.signature;
        if (typeof sig === "string") thinkingBytes += sig.length;
      }
    }
  }

  if (textParts.length === 0 && thinkingBlocks === 0) return null;

  return {
    model,
    text: textParts.join("\n\n"),
    thinkingBlocks,
    thinkingBytes,
  };
}

