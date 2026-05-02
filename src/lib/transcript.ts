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
  thinking: string;
}

export interface ContextSnapshot {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  /** Total tokens contributing to context window usage */
  totalContextTokens: number;
  remainingPct: number;
}

// Context window sizes by model family
const CONTEXT_WINDOW_SIZES: Record<string, number> = {
  "claude-opus-4": 1_000_000,
  "claude-sonnet-4": 200_000,
  "claude-haiku-4": 200_000,
};

function getContextWindowSize(model: string): number {
  for (const [prefix, size] of Object.entries(CONTEXT_WINDOW_SIZES)) {
    if (model.startsWith(prefix)) return size;
  }
  return 200_000; // conservative default
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

/**
 * Extract text + thinking blocks from the most recent assistant entry in the
 * transcript. Reads from the end of the file. Returns null if no assistant
 * entry has any text/thinking content (e.g. tool-use only).
 */
export function getLatestAssistantTurn(filePath: string): AssistantTurn | null {
  if (!existsSync(filePath)) return null;

  const text = readFileSync(filePath, "utf-8");
  const lines = text.split("\n");

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;

    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type !== "assistant") continue;

    const message = entry.message as Record<string, unknown> | undefined;
    if (!message) continue;

    const model = (message.model as string) ?? "";
    const content = message.content as Array<Record<string, unknown>> | undefined;
    if (!content) continue;

    const textParts: string[] = [];
    const thinkingParts: string[] = [];
    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string") {
        textParts.push(block.text);
      } else if (block.type === "thinking" && typeof block.thinking === "string") {
        thinkingParts.push(block.thinking);
      }
    }

    if (textParts.length === 0 && thinkingParts.length === 0) continue;

    return {
      model,
      text: textParts.join("\n\n"),
      thinking: thinkingParts.join("\n\n"),
    };
  }

  return null;
}

/**
 * Compute a context window snapshot from the latest assistant turn.
 * Reads from the end of the file for speed.
 */
export function getContextSnapshot(filePath: string): ContextSnapshot | null {
  if (!existsSync(filePath)) return null;

  const text = readFileSync(filePath, "utf-8");
  const lines = text.split("\n");

  // Walk backwards to find the last assistant message with usage
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;

    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type !== "assistant") continue;

    const message = entry.message as Record<string, unknown> | undefined;
    const usage = message?.usage as Partial<AssistantUsage> | undefined;
    if (!usage) continue;

    const model = (message?.model as string) ?? "";
    const inputTokens = usage.input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;
    const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;
    const cacheReadTokens = usage.cache_read_input_tokens ?? 0;

    // Context usage = input + cache read (cache creation is new entries, already counted in input)
    const totalContextTokens = inputTokens + cacheCreationTokens + cacheReadTokens;
    const windowSize = getContextWindowSize(model);
    const remainingPct = Math.max(0, Math.min(100, Math.round(100 - (totalContextTokens * 100) / windowSize)));

    return {
      model,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      totalContextTokens,
      remainingPct,
    };
  }

  return null;
}
