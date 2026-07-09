import type { EventRow, SessionRow } from "../api/types";
import { colorOf, labelOf } from "./timeline/categories";
import { iconOf } from "./timeline/icons";

type SessionStatus = SessionRow["status"];

const PALETTE_BY_STATUS = {
  active: "green",
  waiting: "yellow",
  paused: "neutral",
  archived: "neutral",
} as const;

export function statusColor(status: SessionStatus) {
  return PALETTE_BY_STATUS[status];
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

export const eventIcon = iconOf;

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

export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}
