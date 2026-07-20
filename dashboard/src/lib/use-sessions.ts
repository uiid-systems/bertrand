import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"

import { sessionsQuery } from "../api/queries"
import type { SessionWithCategory } from "../api/types"
import { useSelectedProjects } from "../components/sidebar/selected-projects"

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
export function useAllSessions(): SessionWithCategory[] {
  const { projects } = useSelectedProjects()
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
 * A view over the shared session list, narrowed to the sidebar's selected
 * projects. This mirrors the old server-side semantics: an uninitialized
 * selection falls back to the active project, an explicit empty selection shows
 * nothing.
 */
export function useSessions(
  opts: {
    includeArchived?: boolean
  } = {},
): SessionWithCategory[] {
  const all = useAllSessions()
  const { queryProjects, projects } = useSelectedProjects()
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
