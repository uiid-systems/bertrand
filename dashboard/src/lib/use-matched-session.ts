import { useQuery } from "@tanstack/react-query";

import { sessionsQuery } from "../api/queries";
import type { SessionWithCategory } from "../api/types";
import { useSelectedProjects } from "../components/sidebar/selected-projects";
import { findSessionFromSplat } from "./find-session-from-splat";

/**
 * Resolve the current route splat/pathname to a session. Matches first against
 * the visible (view-filtered) list, then a full fallback list spanning every
 * project and archived rows — so a deep-linked or filtered-out session still
 * resolves. Both queries are react-query-cached, so calling this from more than
 * one place (the shell + the route) shares a single fetch.
 */
export function useMatchedSession(splat: string): SessionWithCategory | null {
  const { projects, queryProjects } = useSelectedProjects();

  const { data: visibleSessions = [] } = useQuery(
    sessionsQuery({ projects: queryProjects }),
  );
  const { data: allSessions = [] } = useQuery(
    sessionsQuery({
      includeArchived: true,
      projects: projects.map((p) => p.slug),
    }),
  );

  return (
    findSessionFromSplat(splat, visibleSessions) ??
    findSessionFromSplat(splat, allSessions)
  );
}
