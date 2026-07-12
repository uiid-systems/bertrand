import { useCallback, useSyncExternalStore } from "react"

/**
 * User's on/off preference for browser notifications. On by default; persisted
 * to localStorage. Mirrors `use-theme.ts` (useSyncExternalStore + a synthetic
 * storage event so same-tab toggles re-render). Enabling also nudges the
 * browser's permission prompt if it hasn't been answered yet.
 */

const STORAGE_KEY = "bertrand:notifications-enabled"

// Absence = default ON; only an explicit "0" disables.
function getSnapshot(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== "0"
}

function subscribe(callback: () => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) callback()
  }
  window.addEventListener("storage", handler)
  return () => window.removeEventListener("storage", handler)
}

export function requestNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return
  if (Notification.permission === "default") {
    void Notification.requestPermission().catch(() => {})
  }
}

export function useNotificationSetting() {
  const enabled = useSyncExternalStore(subscribe, getSnapshot, () => true)

  const setEnabled = useCallback((next: boolean) => {
    localStorage.setItem(STORAGE_KEY, next ? "1" : "0")
    if (next) requestNotificationPermission()
    // Same-tab notification — native storage event only fires in other tabs.
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: STORAGE_KEY,
        newValue: next ? "1" : "0",
      }),
    )
  }, [])

  return { enabled, setEnabled } as const
}
