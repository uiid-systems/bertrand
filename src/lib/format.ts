const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Format milliseconds as human-readable duration: "2m", "1h 23m", "3d 4h" */
export function formatDuration(ms: number): string {
  if (ms < MINUTE) return `${Math.round(ms / SECOND)}s`;

  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

/**
 * Format a stored timestamp as relative time: "2m ago", "3h ago", "yesterday".
 *
 * Parsed with {@link parseDbTime}, not `new Date` — its callers pass columns
 * (`startedAt`, `updatedAt`) that are written in SQLite's zone-less shape, and
 * reading those as local time shifts every label by the machine's UTC offset.
 */
export function formatAgo(storedOrDate: string | Date): string {
  const at =
    typeof storedOrDate === "string"
      ? parseDbTime(storedOrDate)
      : storedOrDate.getTime();
  const ms = Date.now() - at;

  if (ms < MINUTE) return "now";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
  if (ms < 2 * DAY) return "yesterday";
  if (ms < 7 * DAY) return `${Math.floor(ms / DAY)}d`;

  return new Date(at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Epoch ms for a stored timestamp. SQLite's datetime('now') strings
 * ("YYYY-MM-DD HH:MM:SS") are UTC but carry no zone marker, so new Date()
 * would read them as LOCAL time and skew comparisons by the machine's UTC
 * offset. ISO strings (transcript ingestion's backdated createdAt) parse
 * as-is.
 */
export function parseDbTime(timestamp: string): number {
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timestamp)) {
    return Date.parse(timestamp.replace(" ", "T") + "Z");
  }
  return Date.parse(timestamp);
}

/**
 * Inverse of {@link parseDbTime}: epoch ms → the `datetime('now')` shape
 * ("YYYY-MM-DD HH:MM:SS", UTC) that events are stored and sorted in.
 *
 * Lives here rather than at the callsite because the two formats must not be
 * mixed within one comparison. `computeTimings` measures its segments with a
 * bare `new Date()`, which reads a zone-less string as LOCAL — so a backdated
 * event written in ISO and compared against a `datetime('now')` neighbour comes
 * out skewed by the machine's UTC offset. Emitting in this shape keeps every
 * timestamp the timing FSM sees in the same one.
 */
export function formatDbTime(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

/** Truncate text to maxLen, adding ellipsis if needed */
export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}

/** Format an ISO timestamp as a short time: "4:23 PM" or "Mar 12 4:23 PM" */
export function formatTime(iso: string, includeDate = false): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  if (!includeDate) return time;
  const day = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  return `${day} ${time}`;
}
