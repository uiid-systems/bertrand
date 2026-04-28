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

/** Format an ISO timestamp as relative time: "2m ago", "3h ago", "yesterday" */
export function formatAgo(isoOrDate: string | Date): string {
  const date = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  const ms = Date.now() - date.getTime();

  if (ms < MINUTE) return "just now";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h ago`;
  if (ms < 2 * DAY) return "yesterday";
  if (ms < 7 * DAY) return `${Math.floor(ms / DAY)}d ago`;

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
