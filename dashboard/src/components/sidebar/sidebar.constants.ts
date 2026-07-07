import type { SessionStatus } from "../../api/types";

/**
 * Statuses that qualify for the pinned "Needs you" zone, in priority order.
 * Waiting comes first: a waiting session is blocked on the user (they're the
 * bottleneck), whereas an active one is Claude working — nothing to act on yet.
 */
export const LIVE_STATUS_ORDER: SessionStatus[] = ["waiting", "active"];
