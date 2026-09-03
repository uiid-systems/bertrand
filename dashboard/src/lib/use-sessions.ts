import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"

import { allStatsQuery, sessionsQuery } from "../api/queries"
import type { SessionStatsRow, SessionListRow } from "../api/types"
import { isLive } from "../components/sidebar/sidebar.utils"

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
 * The one shared stats poll, over the same superset for the same reason:
 * peer-relative readouts (the usage badge and its secondary-sidebar twin) must
 * all rank against one set, or the same session reads "heavy" in one place and
 * not the other.
 */
export function useAllStats(): Record<string, SessionStatsRow> {
  const hasLiveSession = useAllSessions().some(isLive)
  const { data = {} } = useQuery(allStatsQuery({ hasLiveSession }))
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
