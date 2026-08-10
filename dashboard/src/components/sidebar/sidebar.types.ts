import type { SessionWithCategory } from "../../api/types";

/**
 * A collapsible run of sessions under one header. Deliberately agnostic about
 * what `key` names — the project zone groups by category path, the live zone by
 * project slug — so both can render through the same `SessionGroup` component.
 */
export type SessionGroup = {
  key: string;
  label: string;
  sessions: SessionWithCategory[];
};
