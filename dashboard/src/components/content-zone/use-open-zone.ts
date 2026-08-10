import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "bertrand:content:open-zone";

/**
 * Which main-area zone is expanded, persisted across reloads and across
 * navigation between sessions. The main area is an accordion: **at most one**
 * zone is open, and none is a legal state — so the store holds a single zone id
 * rather than the set of collapsed ones, which makes "both open" unrepresentable
 * instead of something every reader has to guard against.
 *
 * The three values are distinct: a zone id (that zone owns the column), `null`
 * (the reader closed everything), and `undefined` (nothing stored yet, so
 * `defaultOpen` decides). Collapsing the last open zone must persist as `null`,
 * not fall back to a default, or the column would spring open again on reload.
 *
 * Follows the same shape as `useZoneDim`: one module-level store, so every zone
 * sees the same value and toggles can't clobber each other's writes.
 *
 * Persisting this matters more here than in the sidebar: expanding the terminal
 * zone attaches to a live PTY and asks it to repaint, so someone who collapsed
 * it should not have it reattach every time they open a session.
 */
let openZone = read();
const listeners = new Set<() => void>();

function read(): string | null | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed === "string") return parsed;
  } catch {
    // Malformed or unavailable storage — fall back to the defaults.
  }
  return undefined;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * @param zoneId  This zone's identity in the accordion.
 * @param defaultOpen  Whether this zone owns the column before the reader has
 *   expressed a preference. At most one zone in a column should pass `true`.
 */
export function useOpenZone(
  zoneId: string,
  { defaultOpen = false }: { defaultOpen?: boolean } = {},
) {
  const open = useSyncExternalStore(
    subscribe,
    () => (openZone === undefined ? defaultOpen : openZone === zoneId),
    () => defaultOpen,
  );

  // Opening a zone closes its siblings by construction — there is one slot and
  // this claims it. Closing gives the slot to nobody, collapsing the column to
  // its trigger bars.
  const setOpen = useCallback(
    (next: boolean) => {
      openZone = next ? zoneId : null;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(openZone));
      } catch {
        // Storage unavailable — the choice stays in-memory this session.
      }
      listeners.forEach((l) => l());
    },
    [zoneId],
  );

  return { open, setOpen };
}
