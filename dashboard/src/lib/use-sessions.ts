import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"

import { sessionsQuery } from "../api/queries"
import type { SessionWithCategory } from "../api/types"
import { useSelectedProjects } from "../components/sidebar/selected-projects"

/**
 * The one shared session poll. Consumers used to subscribe to ~4 distinct
 * `sessionsQuery` keys (shell, sidebar, matched-session fallback,
 * notifications), each its own 2s fetch of mostly identical rows. Now a single
 * superset query — every known project, archived included — feeds them all,
 * and each view derives its slice client-side via `useSessions`.
 *
 * Slugs are sorted so the query key (and thus the cache entry) stays stable
 * regardless of registry order. Consumers must not depend on cross-project row
 * order — the sidebar re-sorts by activity anyway.
 */
export function useAllSessions(opts?: {
  /** Keep the poll alive in a backgrounded tab (the notifications hook). */
  refetchIntervalInBackground?: boolean
}): SessionWithCategory[] {
  const { projects } = useSelectedProjects()
  const allSlugs = useMemo(
    () => projects.map((p) => p.slug).sort(),
    [projects],
  )
  const { data = [] } = useQuery({
    ...sessionsQuery({ includeArchived: true, projects: allSlugs }),
    enabled: allSlugs.length > 0,
    refetchIntervalInBackground: opts?.refetchIntervalInBackground,
  })
  return data
}

/**
 * A view over the shared session list.
 *
 * `scope: "view"` (default) narrows to the sidebar's selected projects,
 * mirroring the old server-side semantics: an uninitialized selection falls
 * back to the active project, an explicit empty selection shows nothing.
 * `scope: "all"` spans every project (the notifications hook).
 */
export function useSessions(
  opts: {
    includeArchived?: boolean
    scope?: "view" | "all"
    refetchIntervalInBackground?: boolean
  } = {},
): SessionWithCategory[] {
  const all = useAllSessions({
    refetchIntervalInBackground: opts.refetchIntervalInBackground,
  })
  const { queryProjects, projects } = useSelectedProjects()
  const activeSlug = projects.find((p) => p.active)?.slug
  const { includeArchived, scope } = opts

  return useMemo(() => {
    const slugFilter =
      scope === "all"
        ? null
        : new Set(queryProjects ?? (activeSlug ? [activeSlug] : []))
    return all.filter((row) => {
      if (!includeArchived && row.session.status === "archived") return false
      if (!slugFilter) return true
      const slug = row.project?.slug
      return slug != null && slugFilter.has(slug)
    })
  }, [all, includeArchived, scope, queryProjects, activeSlug])
}
