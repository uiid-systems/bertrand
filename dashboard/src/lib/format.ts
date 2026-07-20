import type { EventRow, SessionRow } from "../api/types";
import { colorOf, labelOf } from "./timeline/categories";

type SessionStatus = SessionRow["status"];

const PALETTE_BY_STATUS = {
  active: "green",
  waiting: "yellow",
  blocked: "red",
  paused: "neutral",
  archived: "neutral",
} as const;

export function statusColor(status: SessionStatus) {
  return PALETTE_BY_STATUS[status];
}

/** A session is "live" while Claude is engaged: active, awaiting a reply, or blocked on approval. */
export function isLiveStatus(status: SessionStatus): boolean {
  return status === "active" || status === "waiting" || status === "blocked";
}

const LABEL_BY_STATUS = {
  active: "active",
  waiting: "waiting",
  blocked: "needs approval",
  paused: "paused",
  archived: "archived",
} as const;

/**
 * Human-facing status label. Only `blocked` diverges from its raw value —
 * "needs approval" reads better than the bare enum word wherever a status is
 * shown as text (badges).
 */
export function statusLabel(status: SessionStatus): string {
  return LABEL_BY_STATUS[status];
}

export function formatDuration(seconds: number): string {
  if (seconds < 1) return "0s";

  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatRelativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;

  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;

  return new Date(iso).toLocaleDateString(undefined, {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
  });
}

export const eventColor = colorOf;

export const eventLabel = labelOf;

// NB: no `eventIcon` re-export here. `iconOf` pulls in `@uiid/icons`, a UI
// package absent from the root `bun test` environment; keeping it out of this
// module lets the pure formatters (and their tests) import from here freely.
// UI code imports `iconOf` directly from `./timeline/icons`.

type AppliedEdit = { oldStr?: string; newStr?: string };
type AppliedPermission = {
  detail?: string;
  oldStr?: string;
  newStr?: string;
  edits?: AppliedEdit[];
};

function lineCount(s: string | undefined): number {
  if (!s) return 0;
  return s.split("\n").length;
}

function basenameOf(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

/**
 * Render a one-liner that summarizes a `tool.applied` event. Matches
 * `computeDiffStats` on the server: each edit's oldStr counts as removed
 * lines, newStr counts as added lines — coarse but consistent with the
 * sidebar's +/- badges. Returns null when there's nothing file-shaped to
 * summarize so the caller can fall back to the bare event label.
 */
function summarizeApplied(meta: Record<string, unknown>): string | null {
  const permissions = meta.permissions as AppliedPermission[] | undefined;
  if (!permissions || permissions.length === 0) return null;

  const filenames = new Set<string>();
  let totalEdits = 0;
  let linesAdded = 0;
  let linesRemoved = 0;

  for (const p of permissions) {
    if (p.detail) filenames.add(p.detail);
    if (p.edits && p.edits.length > 0) {
      totalEdits += p.edits.length;
      for (const e of p.edits) {
        linesRemoved += lineCount(e.oldStr);
        linesAdded += lineCount(e.newStr);
      }
    } else if (p.oldStr || p.newStr) {
      totalEdits += 1;
      linesRemoved += lineCount(p.oldStr);
      linesAdded += lineCount(p.newStr);
    }
  }

  if (filenames.size === 0) return null;

  const counts =
    linesAdded || linesRemoved ? ` (+${linesAdded} -${linesRemoved})` : "";

  if (filenames.size === 1) {
    const file = filenames.values().next().value!;
    const name = basenameOf(file);
    if (totalEdits > 1) return `${totalEdits} edits to ${name}${counts}`;
    return `edited ${name}${counts}`;
  }

  return `edited ${filenames.size} files${counts}`;
}

type TurnPermission = {
  tool?: string;
  count?: number;
  detail?: string;
  oldStr?: string;
  newStr?: string;
  edits?: AppliedEdit[];
};

const READ_TOOLS = new Set(["Read", "NotebookRead"]);

/** Folded activity of a consolidated agent turn: total tool calls, how many were
 * reads, and the file/line-diff breakdown. `filesEdited` is a distinct-path
 * count; line counts mirror `summarizeApplied` (oldStr → removed, newStr →
 * added) so the +/- matches the sidebar's changed-files badges. */
export type AgentTurnStats = {
  toolCalls: number;
  reads: number;
  filesEdited: number;
  linesAdded: number;
  linesRemoved: number;
};

/**
 * Tally the tool work a consolidated `agent.turn` card folds away, so callers
 * can surface it beside the timestamp. Returns null for a non-turn card, or a
 * turn that did no tool work (pure prose) — the caller then shows the bare
 * timestamp.
 */
export function agentTurnStats(event: EventRow): AgentTurnStats | null {
  if (event.event !== "agent.turn") return null;
  const meta = event.meta as Record<string, unknown> | null;
  const parts = (meta?.parts as EventRow[] | undefined) ?? [];

  let toolCalls = 0;
  let reads = 0;
  const filesEdited = new Set<string>();
  let linesAdded = 0;
  let linesRemoved = 0;

  for (const part of parts) {
    if (part.event !== "tool.work" && part.event !== "tool.applied") continue;
    const partMeta = part.meta as Record<string, unknown> | null;
    const permissions = (partMeta?.permissions ?? []) as TurnPermission[];
    for (const p of permissions) {
      const count = p.count ?? 1;
      toolCalls += count;
      if (p.tool && READ_TOOLS.has(p.tool)) reads += count;

      if (p.edits && p.edits.length > 0) {
        if (p.detail) filesEdited.add(p.detail);
        for (const e of p.edits) {
          linesRemoved += lineCount(e.oldStr);
          linesAdded += lineCount(e.newStr);
        }
      } else if (p.oldStr || p.newStr) {
        if (p.detail) filesEdited.add(p.detail);
        linesRemoved += lineCount(p.oldStr);
        linesAdded += lineCount(p.newStr);
      }
    }
  }

  if (toolCalls === 0) return null;

  return {
    toolCalls,
    reads,
    filesEdited: filesEdited.size,
    linesAdded,
    linesRemoved,
  };
}

/**
 * Plain-text form of {@link agentTurnStats} ("6 tools · 2 reads · 1 file (+40
 * -7)"), for text-only contexts. The UI renders {@link AgentTurnSummary} — the
 * badge/diff version — instead.
 */
export function summarizeAgentTurn(event: EventRow): string | null {
  const stats = agentTurnStats(event);
  if (!stats) return null;

  const { toolCalls, reads, filesEdited, linesAdded, linesRemoved } = stats;
  const segments = [`${toolCalls} ${toolCalls === 1 ? "tool" : "tools"}`];
  if (reads > 0) segments.push(`${reads} ${reads === 1 ? "read" : "reads"}`);
  if (filesEdited > 0) {
    const counts =
      linesAdded || linesRemoved ? ` (+${linesAdded} -${linesRemoved})` : "";
    const noun = filesEdited === 1 ? "file" : "files";
    segments.push(`${filesEdited} ${noun}${counts}`);
  }
  return segments.join(" · ");
}

export function eventTitle(event: EventRow): string {
  const label = eventLabel(event.event);
  const meta = event.meta as Record<string, unknown> | null;

  if (!meta) return label;

  switch (event.event) {
    case "session.answered": {
      const question = meta.question as string | undefined;
      return question ?? label;
    }
    case "tool.work":
      return event.summary ?? label;
    case "tool.applied":
      return summarizeApplied(meta) ?? label;
    default:
      return label;
  }
}

/** Longest a derived TOC title runs before we hand off to CSS truncation. */
const TOC_TITLE_MAX = 140;

/** Collapse a block of prose to a single trimmed line, capped so we never hand
 * the sidebar a giant string (it still `truncate`s to the column width). */
function snippet(text: string | null | undefined): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > TOC_TITLE_MAX
    ? clean.slice(0, TOC_TITLE_MAX - 1) + "…"
    : clean;
}

/** First bit of the agent's prose in a consolidated turn, skipping pure tool
 * work. Null when the whole turn was tool calls with no reply text. */
function firstProseSnippet(event: EventRow): string | null {
  const meta = event.meta as Record<string, unknown> | null;
  const parts = (meta?.parts as EventRow[] | undefined) ?? [];
  for (const part of parts) {
    if (part.event !== "assistant.message") continue;
    const partMeta = part.meta as Record<string, unknown> | null;
    const s = snippet(partMeta?.text as string | undefined);
    if (s) return s;
  }
  return null;
}

/**
 * Title for the sidebar timeline table-of-contents. `eventTitle`'s generic
 * "User prompted" / "Agent's response" labels read fine in the main timeline —
 * the card body sits right below them — but the sidebar list has no body to lean
 * on, so a column of identical labels tells no story. Here we derive the title
 * from the event's own prose instead: the prompt text for a human turn, the
 * agent's first reply for a response. Events that already carry a descriptive
 * `eventTitle` (the question asked, the tool summary) defer to it unchanged.
 */
export function eventTocTitle(event: EventRow): string {
  const meta = event.meta as Record<string, unknown> | null;

  switch (event.event) {
    case "user.prompt":
      return snippet(meta?.prompt as string | undefined) ?? eventTitle(event);
    case "assistant.message":
      return snippet(meta?.text as string | undefined) ?? eventTitle(event);
    case "agent.turn":
      return firstProseSnippet(event) ?? eventTitle(event);
    default:
      return eventTitle(event);
  }
}

export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}
