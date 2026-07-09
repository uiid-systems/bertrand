import type { SessionStatus } from "../../api/types";

/**
 * Statuses that qualify for the pinned "Needs you" zone, in priority order.
 * Blocked comes first: Claude is halted awaiting the user's approval to run a
 * command. Then waiting (a question the user must answer). Then active (Claude
 * working — nothing to act on yet).
 */
export const LIVE_STATUS_ORDER: SessionStatus[] = [
  "blocked",
  "waiting",
  "active",
];
