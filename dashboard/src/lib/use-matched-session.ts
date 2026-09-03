import type { SessionListRow } from "../api/types";
import { findSessionFromSplat } from "./find-session-from-splat";
import { useAllSessions, useSessions } from "./use-sessions";

/**
 * Resolve the current route splat/pathname to a session. Matches first against
 * the visible list, then the superset that also carries archived rows — so a
 * session deep-linked while "show archived" is off still resolves. Both views
 * derive from the same shared session poll, so calling this from more than one
 * place (the shell + the route) adds no fetches.
 */
export function useMatchedSession(splat: string): SessionListRow | null {
  const visibleSessions = useSessions();
  const allSessions = useAllSessions();

  return (
    findSessionFromSplat(splat, visibleSessions) ??
    findSessionFromSplat(splat, allSessions)
  );
}
