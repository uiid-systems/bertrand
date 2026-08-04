/**
 * Resolves the bertrand API origin.
 *
 * Order:
 *   1. localStorage `bertrand:apiBase` — runtime override set by a settings UI.
 *   2. `VITE_API_BASE` build-time env — set by hosted builds (e.g. bertrand.sh)
 *      so the hosted SPA talks back to the user's local bertrand server.
 *   3. Same-origin (empty string) — bundled dashboard served by `bertrand serve`.
 *
 * Same-origin is the default because the most common deployment is `bertrand
 * serve` hosting both the API and the SPA on one port; relative fetches just
 * work there.
 */
export const STORAGE_KEY = "bertrand:apiBase"

export function apiBase(): string {
  if (typeof window !== "undefined") {
    try {
      const override = window.localStorage.getItem(STORAGE_KEY)
      if (override) return override.replace(/\/$/, "")
    } catch {
      // localStorage unavailable (private mode, etc.) — fall through.
    }
  }
  const envBase = import.meta.env.VITE_API_BASE
  if (typeof envBase === "string" && envBase.length > 0) {
    return envBase.replace(/\/$/, "")
  }
  return ""
}

export function setApiBase(value: string | null): void {
  if (typeof window === "undefined") return
  try {
    if (value === null || value.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY)
    } else {
      window.localStorage.setItem(STORAGE_KEY, value)
    }
  } catch {
    // No-op in private mode.
  }
}

export function apiUrl(path: string): string {
  return `${apiBase()}${path}`
}

/**
 * Same resolution as `apiUrl`, but for `ws(s)://` — used by the terminal
 * relay. Same-origin (the bundled-dashboard default) has no http(s) prefix to
 * swap, so it derives ws(s) from `window.location` instead.
 */
export function wsUrl(path: string): string {
  const base = apiBase()
  if (base) return `${base.replace(/^http/, "ws")}${path}`
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${protocol}//${window.location.host}${path}`
}
