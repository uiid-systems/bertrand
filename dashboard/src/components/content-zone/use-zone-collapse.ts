import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "bertrand:content:collapsed-zones";

/**
 * Which main-area zones the reader has collapsed, persisted across reloads and
 * across navigation between sessions. Follows the same shape as
 * `useZoneDim`: a single module-level store so every zone sees the same state
 * and toggles can't clobber each other's writes, and *collapsed* ids are stored
 * (not expanded ones) so a zone we add later defaults to open.
 *
 * Persisting this matters more here than in the sidebar: expanding the terminal
 * zone attaches to a live PTY and asks it to repaint, so someone who collapsed
 * it should not have it reattach every time they open a session.
 */
let collapsed = read();
const listeners = new Set<() => void>();

function read(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) {
      return new Set(parsed as string[]);
    }
  } catch {
    // Malformed or unavailable storage — treat every zone as open.
  }
  return new Set();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useZoneCollapse(zoneId: string) {
  const open = useSyncExternalStore(
    subscribe,
    () => !collapsed.has(zoneId),
    () => true,
  );

  const setOpen = useCallback(
    (next: boolean) => {
      const updated = new Set(collapsed);
      if (next) updated.delete(zoneId);
      else updated.add(zoneId);
      collapsed = updated;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...collapsed]));
      } catch {
        // Storage unavailable — collapse state stays in-memory this session.
      }
      listeners.forEach((l) => l());
    },
    [zoneId],
  );

  return { open, setOpen };
}
