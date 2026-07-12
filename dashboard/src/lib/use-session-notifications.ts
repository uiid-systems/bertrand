import { useEffect, useRef } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"

import { sessionsQuery } from "../api/queries"
import { useSelectedProjects } from "../components/sidebar/selected-projects"
import { useNotificationSetting, requestNotificationPermission } from "./use-notification-setting"

/**
 * Browser notifications for "Claude needs you" moments. Purely client-side: it
 * polls sessions across *all* projects (independent of the sidebar's project
 * filter) and fires a native Notification when one crosses into a status that
 * wants attention. No server or DB changes involved.
 *
 * `localhost` counts as a secure context, so this works under `bertrand serve`
 * without HTTPS.
 */

/** Statuses worth interrupting the user for, with the line shown in the body. */
const NOTIFY_STATUSES: Record<string, string> = {
  waiting: "is waiting for your answer",
  blocked: "hit a permission prompt",
}

export function useSessionNotifications() {
  const navigate = useNavigate()
  const { enabled } = useNotificationSetting()
  const { projects } = useSelectedProjects()

  // Notify globally: every known project, not just the ones currently shown in
  // the sidebar filter. Gate on projects being loaded so we prime against the
  // full all-projects set in one shot — priming against the active-project-only
  // fallback first would make every other project's sessions look like fresh
  // transitions the moment the real list arrives.
  const allSlugs = projects.map((p) => p.slug)
  const { data: sessions = [] } = useQuery({
    ...sessionsQuery({ projects: allSlugs }),
    enabled: allSlugs.length > 0,
    // Keep polling even when the tab is backgrounded — otherwise React Query
    // pauses the interval (default refetchIntervalInBackground: false) and we'd
    // miss the very transitions the user stepped away to be notified about.
    refetchIntervalInBackground: true,
  })

  // On by default: ask for permission once, as long as the user hasn't turned
  // notifications off.
  useEffect(() => {
    if (enabled) requestNotificationPermission()
  }, [enabled])

  // Last-seen status per session id, plus a prime flag so the first snapshot
  // (which may already contain waiting/blocked sessions) doesn't blast a
  // notification for every one of them on page load.
  const prevStatus = useRef(new Map<string, string>())
  const primed = useRef(false)

  useEffect(() => {
    // Nothing to diff until the first real page of data arrives. Priming on an
    // empty snapshot would make the first populated poll look like 40+ fresh
    // transitions.
    if (sessions.length === 0) return

    const prev = prevStatus.current
    const next = new Map<string, string>()
    for (const { session } of sessions) next.set(session.id, session.status)

    const canNotify =
      enabled &&
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "granted"

    if (primed.current && canNotify) {
      for (const { session, categoryPath, project } of sessions) {
        const after = session.status
        if (prev.get(session.id) === after) continue
        const message = NOTIFY_STATUSES[after]
        if (!message) continue

        // `<categoryPath>/<slug>` is exactly the session route splat
        // (see findSessionFromSplat / SessionListItem).
        const splat = `${categoryPath}/${session.slug}`
        // Prefix the project so the title reads e.g. "bertrand/parse-urls"
        // (project is present on cross-project rows; fall back if not).
        const title = project ? `${project.slug}/${session.name}` : session.name
        const notification = new Notification(title, {
          body: message,
          // Same tag → a new transition replaces the prior toast for this
          // session instead of stacking.
          tag: session.id,
        })
        notification.onclick = () => {
          window.focus()
          void navigate({ to: "/$", params: { _splat: splat } })
          notification.close()
        }
      }
    }

    prevStatus.current = next
    primed.current = true
  }, [sessions, enabled, navigate])
}
