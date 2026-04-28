import { useCallback, useSyncExternalStore } from "react";

type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "uiid-theme";

function getSnapshot(): Theme {
  return (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "system";
}

function subscribe(callback: () => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) callback();
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

function applyTheme(theme: Theme) {
  if (theme === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot);

  const setTheme = useCallback((next: Theme) => {
    if (next === "system") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, next);
    }
    applyTheme(next);
    // Same-tab notification — native storage event only fires in other tabs
    window.dispatchEvent(
      new StorageEvent("storage", { key: STORAGE_KEY, newValue: next }),
    );
  }, []);

  return { theme, setTheme } as const;
}
