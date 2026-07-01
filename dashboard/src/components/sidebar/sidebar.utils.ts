import type { SessionRow, SessionWithCategory } from "../../api/types";
import type { RecentBucket, GroupBy, SessionGroup } from "./sidebar.types";
import {
  STATUS_ORDER,
  STATUS_LABEL,
  MS_PER_DAY,
  RECENT_ORDER,
  RECENT_LABEL,
} from "./sidebar.constants";

export function recentBucketOf(startedAt: string, now: Date): RecentBucket {
  const start = new Date(startedAt);
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const startOfSession = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
  );
  const dayDiff = Math.floor(
    (startOfToday.getTime() - startOfSession.getTime()) / MS_PER_DAY,
  );
  if (dayDiff <= 0) return "today";
  if (dayDiff === 1) return "yesterday";
  if (dayDiff < 7) return "thisWeek";
  return "earlier";
}

export function groupSessions(
  sessions: SessionWithCategory[],
  axis: GroupBy,
): SessionGroup[] {
  if (axis === "status") {
    const buckets = new Map<SessionRow["status"], SessionWithCategory[]>();
    for (const s of sessions) {
      const key = s.session.status;
      const list = buckets.get(key);
      if (list) list.push(s);
      else buckets.set(key, [s]);
    }
    return STATUS_ORDER.filter((status) => buckets.has(status)).map(
      (status): SessionGroup => ({
        key: status,
        category: STATUS_LABEL[status],
        sessions: buckets.get(status)!,
      }),
    );
  }

  if (axis === "recent") {
    const now = new Date();
    const buckets = new Map<RecentBucket, SessionWithCategory[]>();
    for (const s of sessions) {
      const key = recentBucketOf(s.session.startedAt, now);
      const list = buckets.get(key);
      if (list) list.push(s);
      else buckets.set(key, [s]);
    }
    return RECENT_ORDER.filter((bucket) => buckets.has(bucket)).map(
      (bucket): SessionGroup => ({
        key: bucket,
        category: RECENT_LABEL[bucket],
        sessions: buckets.get(bucket)!,
      }),
    );
  }

  const groups = new Map<string, SessionWithCategory[]>();
  for (const s of sessions) {
    const key = s.categoryPath;
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }

  return Array.from(
    groups,
    ([category, sessions]): SessionGroup => ({
      key: category,
      category,
      sessions,
    }),
  );
}
