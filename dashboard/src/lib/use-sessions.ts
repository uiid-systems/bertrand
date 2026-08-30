import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"

import { allStatsQuery, sessionsQuery } from "../api/queries"
import type { SessionStatsRow, SessionListRow } from "../api/types"
import { useSelectedProject } from "../components/sidebar/selected-project"
import { isLive } from "../components/sidebar/sidebar.utils"

/**
 * The one shared session poll. Consumers used to subscribe to several distinct
 * `sessionsQuery` keys (shell, sidebar, matched-session fallback), each its own
 * 2s fetch of mostly identical rows. Now a single superset query — every known
 * project, archived included — feeds them all, and each view derives its slice
 * client-side via `useSessions`.
 *
 * Slugs are sorted so the query key (and thus the cache entry) stays stable
 * regardless of registry order. Consumers must not depend on cross-project row
 * order — the sidebar re-sorts by activity anyway.
 */
export function useAllSessions(): SessionListRow[] {
  const { projects } = useSelectedProject()
  const allSlugs = useMemo(
    () => projects.map((p) => p.slug).sort(),
    [projects],
  )
  const { data = [] } = useQuery({
    ...sessionsQuery({ includeArchived: true, projects: allSlugs }),
    enabled: allSlugs.length > 0,
  })
  return data
}

/**
 * The one shared stats poll, scoped to every project for the same reason
 * `useAllSessions` is: the live zone spans projects, so a card there needs its
 * diff counters and usage standing whichever project it belongs to. Keeping a
 * single superset key also means switching projects re-slices a warm cache
 * instead of invalidating it.
 *
 * Peer-relative readouts (the usage badge and its secondary-sidebar twin) must
 * all rank against this same set, or the same session reads "heavy" in one
 * place and not the other.
 */
export function useAllStats(): Record<string, SessionStatsRow> {
  const { projects } = useSelectedProject()
  const allSlugs = useMemo(
    () => projects.map((p) => p.slug).sort(),
    [projects],
  )
  const hasLiveSession = useAllSessions().some(isLive)
  const { data = {} } = useQuery({
    ...allStatsQuery({ hasLiveSession, projects: allSlugs }),
    enabled: allSlugs.length > 0,
  })
  return data
}

/**
 * A view over the shared session list, narrowed to the sidebar's selected
 * project. An uninitialized selection falls back to the registry's active
 * project, mirroring the server's own default.
 */
export function useSessions(
  opts: {
    includeArchived?: boolean
  } = {},
): SessionListRow[] {
  const all = useAllSessions()
  const { queryProjects, projects } = useSelectedProject()
  const activeSlug = projects.find((p) => p.active)?.slug
  const { includeArchived } = opts

  return useMemo(() => {
    const slugFilter = new Set(
      queryProjects ?? (activeSlug ? [activeSlug] : []),
    )
    return all.filter((row) => {
      if (!includeArchived && row.session.status === "archived") return false
      const slug = row.project?.slug
      return slug != null && slugFilter.has(slug)
    })
  }, [all, includeArchived, queryProjects, activeSlug])
}
