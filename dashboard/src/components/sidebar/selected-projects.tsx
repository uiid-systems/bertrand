import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";

import { projectsQuery, type ProjectSummary } from "../../api/queries";

const STORAGE_KEY = "bertrand:selected-projects";

function readStorage(): string[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) {
      return parsed as string[];
    }
  } catch {
    // Malformed or unavailable storage — fall back to the default.
  }
  return null;
}

function writeStorage(value: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage unavailable — selection stays in-memory only.
  }
}

type SelectedProjectsValue = {
  /** Every known project — the selector's options and the default source. */
  projects: ProjectSummary[];
  /**
   * Persisted selection, or `null` until a default is seeded. Callers that
   * hit the API should use `queryProjects` instead, which encodes the "not yet
   * chosen" state as `undefined` (server falls back to the active project).
   */
  selected: string[] | null;
  /**
   * The value to hand to `sessionsQuery`/`allStatsQuery`: `undefined` while
   * uninitialized (server uses the active project), otherwise the selection
   * pruned to slugs that still exist.
   */
  queryProjects: string[] | undefined;
  setSelected: (next: string[]) => void;
  /**
   * Forget the persisted choice and snap back to the live-projects default
   * (recomputed now and on future loads until the user picks again).
   */
  resetToLive: () => void;
  /** True when the current view already matches the live-projects default. */
  isAtLiveDefault: boolean;
};

/**
 * The default view: every project with a live (active/waiting) session, since
 * multiple projects are commonly active at once. Falls back to the registry's
 * active project when nothing is live, so the dashboard is never empty.
 */
function liveDefaultOf(projects: ProjectSummary[]): string[] {
  const live = projects.filter((p) => p.liveCount > 0).map((p) => p.slug);
  if (live.length > 0) return live;
  const active = projects.find((p) => p.active);
  return active ? [active.slug] : [];
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedB = [...b].sort();
  return [...a].sort().every((slug, i) => slug === sortedB[i]);
}

const SelectedProjectsContext = createContext<SelectedProjectsValue | null>(
  null,
);

/**
 * Owns the dashboard's project *view* filter — which projects' sessions are
 * shown. Purely a client concern: it never touches the registry's active
 * project (the CLI write-target). Persisted to localStorage; defaults to the
 * active project the first time, so the initial view matches the old
 * single-project behavior.
 */
export function SelectedProjectsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { data: projects = [] } = useQuery(projectsQuery);
  const [selected, setSelectedState] = useState<string[] | null>(() =>
    readStorage(),
  );

  // Seed the live-projects default once projects load, if nothing was
  // persisted. View-only default — never written back to the registry.
  useEffect(() => {
    if (selected === null && projects.length > 0) {
      setSelectedState(liveDefaultOf(projects));
    }
  }, [selected, projects]);

  const setSelected = useCallback((next: string[]) => {
    setSelectedState(next);
    writeStorage(next);
  }, []);

  const resetToLive = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage unavailable — the state reset below still applies this session.
    }
    // Back to the "not yet chosen" state; the seeding effect recomputes the
    // live default (and future loads default to live again).
    setSelectedState(null);
  }, []);

  const value = useMemo<SelectedProjectsValue>(() => {
    const pruned =
      selected === null
        ? undefined
        : selected.filter((slug) => projects.some((p) => p.slug === slug));
    const isAtLiveDefault =
      selected === null || sameSet(pruned ?? [], liveDefaultOf(projects));
    return {
      projects,
      selected,
      queryProjects: pruned,
      setSelected,
      resetToLive,
      isAtLiveDefault,
    };
  }, [projects, selected, setSelected, resetToLive]);

  return (
    <SelectedProjectsContext.Provider value={value}>
      {children}
    </SelectedProjectsContext.Provider>
  );
}

export function useSelectedProjects(): SelectedProjectsValue {
  const ctx = useContext(SelectedProjectsContext);
  if (!ctx) {
    throw new Error(
      "useSelectedProjects must be used within a SelectedProjectsProvider",
    );
  }
  return ctx;
}
