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
};

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
  const active = projects.find((p) => p.active);
  const [selected, setSelectedState] = useState<string[] | null>(() =>
    readStorage(),
  );

  // Seed the default (active project) once projects load, if nothing was
  // persisted. View-only default — never written back to the registry.
  useEffect(() => {
    if (selected === null && active) {
      setSelectedState([active.slug]);
    }
  }, [selected, active]);

  const setSelected = useCallback((next: string[]) => {
    setSelectedState(next);
    writeStorage(next);
  }, []);

  const value = useMemo<SelectedProjectsValue>(() => {
    const pruned =
      selected === null
        ? undefined
        : selected.filter((slug) => projects.some((p) => p.slug === slug));
    return { projects, selected, queryProjects: pruned, setSelected };
  }, [projects, selected, setSelected]);

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
