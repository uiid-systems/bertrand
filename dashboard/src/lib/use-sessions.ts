import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"

import { sessionsQuery } from "../api/queries"
import type { SessionListRow } from "../api/types"

/**
 * The one shared session poll. Consumers used to subscribe to several distinct
 * `sessionsQuery` keys (shell, sidebar, matched-session fallback), each its own
 * 2s fetch of mostly identical rows. Now a single superset query — every
 * session, archived included — feeds them all, and each view derives its slice
 * client-side via `useSessions`.
 *
 * It used to also enumerate every project slug into the query key, so that the
 * live zone could span projects. There is one DB now and the grouping axis
 * (`session.repo`) rides on each row, so the superset is simply "all of them"
 * and no caller has to name a scope to see across one.
 *
 * Consumers must not depend on row order — every view re-sorts, the sidebar by
 * activity.
 */
export function useAllSessions(): SessionListRow[] {
  const { data = [] } = useQuery(sessionsQuery({ includeArchived: true }))
  return data
}

/**
 * A view over the shared session list. The only narrowing left is whether
 * archived rows are included — a session's group is a property of the row, so
 * grouping happens where the list is rendered rather than by filtering here.
 */
export function useSessions(
  opts: {
    includeArchived?: boolean
  } = {},
): SessionListRow[] {
  const all = useAllSessions()
  const { includeArchived } = opts

  // Memoized so the filtered array keeps its identity between polls that
  // changed nothing — several callers feed it straight into a `useMemo` dep.
  return useMemo(
    () =>
      includeArchived
        ? all
        : all.filter((row) => row.session.status !== "archived"),
    [all, includeArchived],
  )
}
