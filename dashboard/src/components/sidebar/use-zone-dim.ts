import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "bertrand:sidebar:dimmed-zones";

/**
 * Which zones the reader has dimmed via their flashlight toggle, persisted
 * across reloads. We store the *dimmed* ids (not the lit ones) so a new zone
 * defaults to lit. A single module-level store shared by every `SidebarZone`
 * keeps toggles from clobbering each other's writes.
 */
let dimmed = read();
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
    // Malformed or unavailable storage — treat every zone as lit.
  }
  return new Set();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useZoneDim(zoneId: string) {
  const lit = useSyncExternalStore(
    subscribe,
    () => !dimmed.has(zoneId),
    () => true,
  );

  const setLit = useCallback(
    (next: boolean) => {
      const updated = new Set(dimmed);
      if (next) updated.delete(zoneId);
      else updated.add(zoneId);
      dimmed = updated;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...dimmed]));
      } catch {
        // Storage unavailable — dim state stays in-memory this session.
      }
      listeners.forEach((l) => l());
    },
    [zoneId],
  );

  return { lit, setLit };
}
