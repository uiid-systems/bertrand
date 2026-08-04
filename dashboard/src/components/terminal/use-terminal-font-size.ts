import { useCallback, useSyncExternalStore } from "react";

import { DEFAULT_FONT_SIZE, FONT_SIZE_BOUNDS } from "./geometry";

const STORAGE_KEY = "bertrand:terminal:font-size";

/**
 * The reader's terminal font size, persisted across reloads and shared by every
 * mounted terminal (one module-level store, same shape as `useZoneDim` /
 * `useZoneCollapse`).
 *
 * This is a *preference*, never derived from the container: a terminal's text
 * does not change size when its window does. Changing it changes how many rows
 * and columns fit the same panel, which re-claims the PTY's grid — the same
 * thing that happens when you change font size in a real terminal.
 */
let fontSize = read();
const listeners = new Set<() => void>();

function clamp(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FONT_SIZE;
  return Math.min(
    FONT_SIZE_BOUNDS.max,
    Math.max(FONT_SIZE_BOUNDS.min, Math.round(value)),
  );
}

function read(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_FONT_SIZE;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return clamp(parsed);
  } catch {
    // Storage unavailable — fall back to the default.
  }
  return DEFAULT_FONT_SIZE;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useTerminalFontSize() {
  const size = useSyncExternalStore(
    subscribe,
    () => fontSize,
    () => DEFAULT_FONT_SIZE,
  );

  const setFontSize = useCallback((next: number) => {
    const clamped = clamp(next);
    if (clamped === fontSize) return;
    fontSize = clamped;
    try {
      localStorage.setItem(STORAGE_KEY, String(clamped));
    } catch {
      // Storage unavailable — the change stays in-memory this session.
    }
    listeners.forEach((l) => l());
  }, []);

  return {
    fontSize: size,
    setFontSize,
    canDecrease: size > FONT_SIZE_BOUNDS.min,
    canIncrease: size < FONT_SIZE_BOUNDS.max,
  };
}
