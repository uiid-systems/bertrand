import type { EnrichedEvent } from "@/lib/types";

export function getMeta(e: EnrichedEvent): Record<string, string> {
  return (e.meta as Record<string, string>) ?? {};
}

export function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Parse an MCP tool name into a human-readable server label.
 * e.g. "mcp__claude_ai_Linear__get_issue" → "Linear"
 * e.g. "mcp__local-mcp__list_agents" → "local-mcp"
 * e.g. "mcp__shadcn__get_add_command_for_items" → "shadcn"
 * Returns null for non-MCP tools.
 */
export function parseMcpServer(toolName: string): string | null {
  const match = toolName.match(/^mcp__(.+?)__/);
  if (!match?.[1]) return null;
  const alias = match[1];
  // claude.ai servers: "claude_ai_Linear" → "Linear"
  const cloudMatch = alias.match(/^claude_ai_(.+)$/);
  return cloudMatch?.[1] ?? alias;
}

/**
 * Clean a tool name for display — collapse MCP names to server label.
 * e.g. "mcp__claude_ai_Linear__get_issue" → "Linear"
 * e.g. "Bash" → "Bash"
 */
export function displayToolName(toolName: string): string {
  return parseMcpServer(toolName) ?? toolName;
}

/**
 * Strip "AskUserQuestion" from a tool.work summary and collapse MCP tool names.
 * e.g. "AskUserQuestion, Edit" → "Edit"
 * e.g. "2× mcp__claude_ai_Linear__get_issue, Bash" → "2× Linear, Bash"
 */
export function cleanWorkSummary(s: string): string {
  return s
    .split(", ")
    .filter((part) => part !== "AskUserQuestion")
    .map((part) => {
      // Handle "N× tool" format
      const countMatch = part.match(/^(\d+×\s*)(.+)$/);
      if (countMatch?.[2]) {
        return countMatch[1] + displayToolName(countMatch[2]);
      }
      return displayToolName(part);
    })
    .join(", ");
}
