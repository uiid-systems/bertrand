import { useCallback, useState } from "react";

const STORAGE_KEY = "bertrand:sidebar:collapsed-projects";

function read(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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
 * Persists which project sections the user has collapsed. Stores the
 * *collapsed* keys (not the open ones) so a newly appearing project defaults to
 * expanded, and a project's collapsed state survives being filtered out and
 * later returning.
 */
export function useCollapsedProjects() {
  const [collapsed, setCollapsedState] = useState<string[]>(() => read());

  const setCollapsed = useCallback((next: string[]) => {
    setCollapsedState(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable — collapse state stays in-memory this session.
    }
  }, []);

  return { collapsed, setCollapsed };
}
