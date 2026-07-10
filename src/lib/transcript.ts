/**
 * JSONL transcript parser for Claude Code conversation files.
 *
 * Transcript files live at ~/.claude/projects/{path-hash}/{conversationId}.jsonl
 * and are append-only. Each line is a JSON object with a `type` discriminator.
 *
 * This module streams files line-by-line and extracts structured summaries
 * without holding the full content in memory.
 */

import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

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
 * True if Claude has a transcript for this session ID under the current
 * CWD. `claude --resume <id>` requires this; otherwise it exits with
 * "No conversation found with session ID: <id>" — bertrand's resume path
 * uses this check to fall back to `--session-id` when the transcript is
 * missing (fresh conversation, never-interacted session, CWD mismatch).
 */
export function claudeSessionExists(sessionId: string, cwd?: string): boolean {
  return existsSync(claudeTranscriptPath(sessionId, cwd));
}

// -- Parsing --

/**
 * Summarize a transcript file: total tokens, model, tool usage, turn count.
 * Streams line-by-line — no full-file buffering.
 */
export function summarizeTranscript(filePath: string): TranscriptSummary | null {
  if (!existsSync(filePath)) return null;

  const text = readFileSync(filePath, "utf-8");
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

    // Model — take the latest (could change mid-session with /fast toggle)
    if (message.model) summary.model = message.model as string;

    // Usage
    const usage = message.usage as Partial<AssistantUsage> | undefined;
    if (usage) {
      summary.turnCount++;
      summary.totalInputTokens += usage.input_tokens ?? 0;
      summary.totalOutputTokens += usage.output_tokens ?? 0;
      summary.totalCacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
      summary.totalCacheReadTokens += usage.cache_read_input_tokens ?? 0;
    }

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

function contentBlocks(
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

