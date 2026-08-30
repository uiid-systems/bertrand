import type { SessionListRow } from "../../api/types";

/**
 * A collapsible run of sessions under one header — the live zone's grouping by
 * project slug.
 */
export type SessionGroup = {
  key: string;
  label: string;
  sessions: SessionListRow[];
};
