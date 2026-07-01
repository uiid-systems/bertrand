import type { SessionRow } from "../../api/types";
import type { RecentBucket } from "./sidebar.types";

export const MS_PER_DAY = 24 * 60 * 60 * 1000; // 1 day in milliseconds

export const STATUS_ORDER: SessionRow["status"][] = [
  "active",
  "waiting",
  "paused",
  "archived",
];

export const STATUS_LABEL: Record<SessionRow["status"], string> = {
  active: "Active",
  waiting: "Waiting",
  paused: "Paused",
  archived: "Archived",
};

export const RECENT_ORDER: RecentBucket[] = [
  "today",
  "yesterday",
  "thisWeek",
  "earlier",
];

export const RECENT_LABEL: Record<RecentBucket, string> = {
  today: "Today",
  yesterday: "Yesterday",
  thisWeek: "This week",
  earlier: "Earlier",
};
