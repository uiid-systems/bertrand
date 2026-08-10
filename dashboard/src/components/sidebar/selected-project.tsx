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

/**
 * Reads the persisted slug. The key predates single-select and used to hold an
 * array, so an old value is migrated in place by taking its first entry —
 * upgrading shouldn't silently move you to a different project.
 */
function readStorage(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "string") return parsed;
    if (Array.isArray(parsed) && typeof parsed[0] === "string") {
      return parsed[0];
    }
  } catch {
    // Malformed or unavailable storage — fall back to the default.
  }
  return null;
}

function writeStorage(value: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage unavailable — selection stays in-memory only.
  }
}

type SelectedProjectValue = {
  /** Every known project — the selector's options and the default source. */
  projects: ProjectSummary[];
  /**
   * The project being viewed, or `null` until a default is seeded. Callers that
   * hit the API should use `queryProjects` instead, which encodes the "not yet
   * chosen" state as `undefined` (server falls back to the active project).
   */
  selected: string | null;
  /**
   * The value to hand to `sessionsQuery`/`allStatsQuery`: `undefined` while
   * uninitialized (server uses the active project), otherwise a one-slug list.
   * Stays an array because the API filter is still a list.
   */
  queryProjects: string[] | undefined;
  setSelected: (next: string) => void;
};

/**
 * The default view: the registry's active project — the CLI's write target and
 * so the one you're most likely working in. Falls back to a project with live
 * sessions, then to the first known project, so the dashboard is never empty.
 */
function defaultProjectOf(projects: ProjectSummary[]): string | null {
  const active = projects.find((p) => p.active);
  if (active) return active.slug;
  const live = projects.find((p) => p.liveCount > 0);
  if (live) return live.slug;
  return projects[0]?.slug ?? null;
}

const SelectedProjectContext = createContext<SelectedProjectValue | null>(null);

/**
 * Owns the dashboard's project *view* filter — whose sessions are shown. Purely
 * a client concern: it never touches the registry's active project (the CLI
 * write-target). Persisted to localStorage; defaults to the active project.
 */
export function SelectedProjectProvider({ children }: { children: ReactNode }) {
  const { data: projects = [] } = useQuery(projectsQuery);
  const [selected, setSelectedState] = useState<string | null>(() =>
    readStorage(),
  );

  // A slug that no longer exists is as good as no choice at all — a removed or
  // renamed project must not strand the sidebar on an empty view.
  const isKnown = selected !== null && projects.some((p) => p.slug === selected);

  // Seed the default once projects load, if nothing usable was persisted.
  // View-only default — never written back to the registry.
  useEffect(() => {
    if (!isKnown && projects.length > 0) {
      setSelectedState(defaultProjectOf(projects));
    }
  }, [isKnown, projects]);

  const setSelected = useCallback((next: string) => {
    setSelectedState(next);
    writeStorage(next);
  }, []);

  const value = useMemo<SelectedProjectValue>(() => {
    const resolved = isKnown ? selected : null;
    return {
      projects,
      selected: resolved,
      queryProjects: resolved === null ? undefined : [resolved],
      setSelected,
    };
  }, [projects, selected, isKnown, setSelected]);

  return (
    <SelectedProjectContext.Provider value={value}>
      {children}
    </SelectedProjectContext.Provider>
  );
}

export function useSelectedProject(): SelectedProjectValue {
  const ctx = useContext(SelectedProjectContext);
  if (!ctx) {
    throw new Error(
      "useSelectedProject must be used within a SelectedProjectProvider",
    );
  }
  return ctx;
}
