import type { SessionWithCategory } from "../../api/types";

export type GroupBy = "group" | "status" | "recent";
export type RecentBucket = "today" | "yesterday" | "thisWeek" | "earlier";

export type SessionGroup = {
  key: string;
  category: string;
  sessions: SessionWithCategory[];
};
