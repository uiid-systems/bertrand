import { useCallback, useRef, useState } from "react";
import { useHotkey, useInput } from "@orchetron/storm";

import type { getAllSessions } from "@/db/queries/sessions";
import type { Mode } from "@/tui/types";

type SessionRow = ReturnType<typeof getAllSessions>[number];
interface UseLaunchHotkeysOpts {
  mode: Mode;
  selected: SessionRow | undefined;
  sessionCount: number;
  quit: () => void;
  setCursor: React.Dispatch<React.SetStateAction<number>>;
  toggleArchived: () => void;
  handleResume: () => void;
  handleStartCreate: () => void;
  handleArchiveToggle: () => void;
  handleStartRename: () => void;
  handleStartMove: () => void;
  handleConfirmDelete: () => void;
  cancelToBrowse: () => void;
  setMode: (mode: Mode) => void;
}

export function useLaunchHotkeys({
  mode,
  selected,
  sessionCount,
  quit,
  setCursor,
  toggleArchived,
  handleResume,
  handleStartCreate,
  handleArchiveToggle,
  handleStartRename,
  handleStartMove,
  handleConfirmDelete,
  cancelToBrowse,
  setMode,
}: UseLaunchHotkeysOpts) {
  // Browse mode: useInput with priority so events are consumed before reaching TextInput.
  // Without consumption, keys like 'n' leak into newly mounted TextInput as the first char.
  useInput(
    (e) => {
      if (e.key === "c" && e.ctrl) {
        e.consumed = true;
        quit();
        return;
      }
      if (e.key === "up" || e.key === "k") {
        setCursor((c) => Math.max(0, c - 1));
      } else if (e.key === "down" || e.key === "j") {
        setCursor((c) => Math.min(sessionCount - 1, c + 1));
      } else if (e.key === "return") {
        handleResume();
      } else if (e.key === "n") {
        handleStartCreate();
      } else if (e.key === "a") {
        handleArchiveToggle();
      } else if (e.key === "d" && selected) {
        setMode("confirm-delete");
      } else if (e.key === "r") {
        handleStartRename();
      } else if (e.key === "m") {
        handleStartMove();
      } else if (e.key === "tab") {
        toggleArchived();
      } else if (e.key === "q") {
        quit();
      } else {
        return;
      }
      e.consumed = true;
    },
    { isActive: mode === "browse", priority: 1 },
  );

  const browseBindings = [
    { label: "navigate", description: "↑↓" },
    { label: "resume", description: "return" },
    { label: "new", description: "n" },
    { label: "archive", description: "a" },
    { label: "delete", description: "d" },
    { label: "rename", description: "r" },
    { label: "move", description: "m" },
    { label: "quit", description: "q" },
  ];

  // Confirm-escape pattern: first Escape shows confirmation, second Escape cancels.
  // Typing anything clears the pending state.
  const escPendingRef = useRef(false);
  const [escPending, setEscPending] = useState(false);

  const clearEscPending = useCallback(() => {
    if (escPendingRef.current) {
      escPendingRef.current = false;
      setEscPending(false);
    }
  }, []);

  const { bindings: inputBindings } = useHotkey({
    hotkeys: [
      {
        key: "escape",
        label: "cancel",
        action: () => {
          if (escPendingRef.current) {
            escPendingRef.current = false;
            setEscPending(false);
            cancelToBrowse();
          } else {
            escPendingRef.current = true;
            setEscPending(true);
          }
        },
      },
    ],
    isActive: mode === "create" || mode === "rename" || mode === "move",
  });

  const { bindings: deleteBindings } = useHotkey({
    hotkeys: [
      { key: "y", label: "confirm", action: handleConfirmDelete },
      { key: "escape", label: "cancel", action: () => setMode("browse") },
    ],
    isActive: mode === "confirm-delete",
  });

  return {
    browseBindings,
    inputBindings,
    deleteBindings,
    escPending,
    clearEscPending,
  } as const;
}
