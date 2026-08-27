import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "bertrand:timeline:tool-work";

/**
 * Whether consolidated agent-turn cards show the tool work folded into them, or
 * just the agent's prose. Hiding it turns a turn card back into what it reads
 * like in the terminal — an uninterrupted reply — instead of prose broken up
 * every few lines by a command or an edit.
 *
 * This is one preference for the whole timeline rather than per-card state:
 * reading a session means reading its turns in sequence, so a per-card toggle
 * would have to be clicked dozens of times to get the same effect. Persisted for
 * the same reason the sidebar's zone state is — someone who reads sessions as
 * prose shouldn't have to re-quiet the timeline on every reload.
 *
 * Follows the module-level store shape of `useOpenZone`/`useZoneDim`: every card
 * subscribes to the same value, so the header toggles stay in agreement and
 * can't clobber each other's writes.
 */
let visible = read();
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "boolean") return parsed;
    }
  } catch {
    // Malformed or unavailable storage — fall back to showing the work, which
    // is what the timeline did before this preference existed.
  }
  return true;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useToolWorkVisible() {
  const shown = useSyncExternalStore(
    subscribe,
    () => visible,
    () => true,
  );

  const setVisible = useCallback((next: boolean) => {
    visible = next;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable — the choice stays in-memory this session.
    }
    listeners.forEach((l) => l());
  }, []);

  return { visible: shown, setVisible };
}
