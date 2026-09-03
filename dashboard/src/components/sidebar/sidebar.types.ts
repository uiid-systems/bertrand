import type { SessionListRow } from "../../api/types";

/**
 * A collapsible run of sessions under one header — the repo a session's cwd
 * resolved to. Both zones group by it, so a session appears under the same
 * heading whether it is live or paused.
 */
export type SessionGroup = {
  /** `owner/repo`, or `""` for the ungrouped bucket. Also the collapse key. */
  key: string;
  label: string;
  sessions: SessionListRow[];
};
