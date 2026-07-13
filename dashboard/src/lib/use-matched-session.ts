import type { SessionWithCategory } from "../api/types";
import { findSessionFromSplat } from "./find-session-from-splat";
import { useAllSessions, useSessions } from "./use-sessions";

/**
 * Resolve the current route splat/pathname to a session. Matches first against
 * the visible (view-filtered) list, then the full superset spanning every
 * project and archived rows — so a deep-linked or filtered-out session still
 * resolves. Both views derive from the same shared session poll, so calling
 * this from more than one place (the shell + the route) adds no fetches.
 */
export function useMatchedSession(splat: string): SessionWithCategory | null {
  const visibleSessions = useSessions();
  const allSessions = useAllSessions();

  return (
    findSessionFromSplat(splat, visibleSessions) ??
    findSessionFromSplat(splat, allSessions)
  );
}
