import type { SessionWithCategory } from "../../api/types";

export type SessionGroup = {
  key: string;
  category: string;
  sessions: SessionWithCategory[];
};

/**
 * The two-zone sidebar layout: a pinned, cross-project live zone plus the
 * per-project sections that hold everything else.
 */
export type SidebarLayout = {
  live: SessionWithCategory[];
  projects: SessionGroup[];
};
