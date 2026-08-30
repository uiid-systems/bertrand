import { useCallback, useEffect, useState } from "react";

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

/**
 * Collapse state that lives only as long as `active` does, mirroring
 * `useCollapsed`'s shape so a caller can swap between the two.
 *
 * This is what a search collapses into. Search results start fully expanded —
 * a hit hidden inside a section the reader shut days ago reads as search being
 * broken — but the reader must still be able to fold a noisy group away without
 * that fold outliving the query, or a stray click during a search would silently
 * rewrite collapses they'd chosen for the unfiltered list. Everything here is
 * dropped the moment the query clears, restoring the persisted state untouched.
 */
export function useEphemeralCollapsed(active: boolean) {
  const [collapsed, setCollapsed] = useState<string[]>([]);

  useEffect(() => {
    // Only ever clears: going inactive discards the search's collapses, so the
    // next search starts expanded again.
    if (!active) setCollapsed([]);
  }, [active]);

  const toggle = useCallback((key: string, open: boolean) => {
    setCollapsed((prev) =>
      open
        ? prev.filter((k) => k !== key)
        : prev.includes(key)
          ? prev
          : [...prev, key],
    );
  }, []);

  return { collapsed, toggle };
}

/** The project zone's own collapsed state, keyed by project slug. */
export const useCollapsedProjects = () =>
  useCollapsed("bertrand:sidebar:collapsed-projects");

/**
 * Collapsed project groups inside the live zone, keyed by project slug.
 *
 * Separate storage from `useCollapsedProjects` even though both key off the
 * same slugs: that one tracks whether the project *zone* is open, and sharing a
 * key would make folding a project's live group silently fold the zone below.
 */
export const useCollapsedLiveProjects = () =>
  useCollapsed("bertrand:sidebar:collapsed-live-projects");
