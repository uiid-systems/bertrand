import { useCallback, useState } from "react";

function read(storageKey: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) {
      return parsed as string[];
    }
  } catch {
    // Malformed or unavailable storage — treat everything as expanded.
  }
  return [];
}

/**
 * Persists which sections the user has collapsed, under `storageKey`. Stores
 * the *collapsed* keys (not the open ones) so a newly appearing section
 * defaults to expanded, and a section's collapsed state survives being filtered
 * out and later returning.
 *
 * State is per call site, not shared — each list of sections must be owned by a
 * single component.
 */
export function useCollapsed(storageKey: string) {
  const [collapsed, setCollapsedState] = useState<string[]>(() =>
    read(storageKey),
  );

  const setCollapsed = useCallback(
    (next: string[]) => {
      setCollapsedState(next);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Storage unavailable — collapse state stays in-memory this session.
      }
    },
    [storageKey],
  );

  const toggle = useCallback(
    (key: string, open: boolean) => {
      // Everything already collapsed (including sections not currently in view)
      // is preserved; we only flip this key.
      const rest = collapsed.filter((k) => k !== key);
      setCollapsed(open ? rest : [...rest, key]);
    },
    [collapsed, setCollapsed],
  );

  return { collapsed, setCollapsed, toggle };
}

/** The project zone's own collapsed state, keyed by project slug. */
export const useCollapsedProjects = () =>
  useCollapsed("bertrand:sidebar:collapsed-projects");

/** Collapsed category groups inside the project zone, keyed by category path. */
export const useCollapsedCategories = () =>
  useCollapsed("bertrand:sidebar:collapsed-categories");

/**
 * Collapsed project groups inside the live zone, keyed by project slug.
 *
 * Separate storage from `useCollapsedProjects` even though both key off the
 * same slugs: that one tracks whether the project *zone* is open, and sharing a
 * key would make folding a project's live group silently fold the zone below.
 */
export const useCollapsedLiveProjects = () =>
  useCollapsed("bertrand:sidebar:collapsed-live-projects");
