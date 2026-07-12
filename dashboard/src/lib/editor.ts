import { useCallback, useSyncExternalStore } from "react";

/**
 * Deep-linking to a local editor from the dashboard.
 *
 * VSCode-family editors register an OS URL scheme that opens an absolute path:
 * `<scheme>://file/<abs path>`. That keeps "Open in editor" a pure frontend
 * anchor — no server round-trip — so it works the same whether the dashboard
 * is served by `bertrand serve` or the hosted build. (The path itself is only
 * meaningful on the machine that owns the worktree.)
 *
 * Which editor to target is a per-machine preference — it depends on what's
 * installed here, not on anything worth syncing across machines — so it lives
 * in localStorage rather than the synced config.
 */
export type EditorId = "cursor" | "vscode";

export const EDITORS: ReadonlyArray<{
  id: EditorId;
  label: string;
  scheme: string;
}> = [
  { id: "cursor", label: "Cursor", scheme: "cursor" },
  { id: "vscode", label: "VS Code", scheme: "vscode" },
];

const STORAGE_KEY = "bertrand:preferred-editor";
const CHANGE_EVENT = "bertrand:preferred-editor-change";
const DEFAULT_EDITOR: EditorId = "cursor";

function isEditorId(value: unknown): value is EditorId {
  return EDITORS.some((e) => e.id === value);
}

export function editorLabel(id: EditorId): string {
  return EDITORS.find((e) => e.id === id)?.label ?? id;
}

/**
 * Build the deep-link that opens an absolute path in the given editor. The
 * path already starts with "/", so the result is e.g.
 * `cursor://file/Users/me/project`. encodeURI preserves the slashes while
 * escaping spaces and other characters a raw path may contain.
 */
export function editorFileUri(id: EditorId, absPath: string): string {
  const scheme = EDITORS.find((e) => e.id === id)?.scheme ?? DEFAULT_EDITOR;
  return `${scheme}://file${encodeURI(absPath)}`;
}

function read(): EditorId {
  if (typeof window === "undefined") return DEFAULT_EDITOR;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isEditorId(stored) ? stored : DEFAULT_EDITOR;
}

function subscribe(onChange: () => void): () => void {
  // CHANGE_EVENT covers same-tab updates (localStorage doesn't fire "storage"
  // in the tab that wrote it); "storage" covers other tabs.
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * Read/write the preferred editor. Backed by localStorage and shared across
 * every component that calls it — changing it in the picker instantly updates
 * the open-link on every worktree row.
 */
export function usePreferredEditor(): [EditorId, (id: EditorId) => void] {
  const editor = useSyncExternalStore(subscribe, read, () => DEFAULT_EDITOR);
  const setEditor = useCallback((id: EditorId) => {
    window.localStorage.setItem(STORAGE_KEY, id);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  return [editor, setEditor];
}
