import { useCallback } from "react";

import {
  updateSessionStatus,
  renameSession,
  moveSession,
  deleteSession,
} from "@/db/queries/sessions";
import { getConversationsBySession } from "@/db/queries/conversations";
import { getOrCreateGroupPath } from "@/db/queries/groups";
import { parseSessionName } from "@/lib/parse-session-name";

import type { getAllSessions } from "@/db/queries/sessions";
import type { LaunchSelection, Mode } from "../screens/launch/launch.types";

type SessionRow = ReturnType<typeof getAllSessions>[number];

interface UseLaunchActionsOpts {
  selected: SessionRow | undefined;
  select: (selection: LaunchSelection) => void;
  refresh: () => void;
  setMode: (mode: Mode) => void;
  setCursor: React.Dispatch<React.SetStateAction<number>>;
  setNewName: React.Dispatch<React.SetStateAction<string>>;
  setEditValue: React.Dispatch<React.SetStateAction<string>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
}

export function useLaunchActions({
  selected,
  select,
  refresh,
  setMode,
  setCursor,
  setNewName,
  setEditValue,
  setError,
}: UseLaunchActionsOpts) {
  const handleResume = useCallback(() => {
    if (!selected) return;
    const conversations = getConversationsBySession(selected.session.id);
    if (conversations.length === 1) {
      select({
        type: "resume",
        sessionId: selected.session.id,
        conversationId: conversations[0]!.id,
      });
    } else {
      select({ type: "pick", sessionId: selected.session.id });
    }
  }, [selected, select]);

  const handleArchiveToggle = useCallback(() => {
    if (!selected) return;
    const newStatus =
      selected.session.status === "archived" ? "paused" : "archived";
    updateSessionStatus(selected.session.id, newStatus);
    refresh();
  }, [selected, refresh]);

  const handleConfirmDelete = useCallback(() => {
    if (!selected) return;
    deleteSession(selected.session.id);
    setCursor((c) => Math.max(0, c - 1));
    setMode("browse");
    refresh();
  }, [selected, refresh, setCursor, setMode]);

  const handleStartRename = useCallback(() => {
    if (!selected) return;
    setMode("rename");
    setEditValue(selected.session.slug);
    setError(null);
  }, [selected, setMode, setEditValue, setError]);

  const handleStartMove = useCallback(() => {
    if (!selected) return;
    setMode("move");
    setEditValue(selected.groupPath);
    setError(null);
  }, [selected, setMode, setEditValue, setError]);

  const handleStartCreate = useCallback(() => {
    setMode("create");
    setNewName("");
    setError(null);
  }, [setMode, setNewName, setError]);

  const cancelToBrowse = useCallback(() => {
    setMode("browse");
    setError(null);
  }, [setMode, setError]);

  const handleCreateSubmit = useCallback(
    (value: string) => {
      if (!value.trim()) return;
      try {
        const { groupPath, slug } = parseSessionName(value);
        select({ type: "create", groupPath, slug });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [select, setError],
  );

  const handleRenameSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || !selected) return;
      if (!/^[a-z0-9][a-z0-9._-]*$/i.test(trimmed)) {
        setError(
          "Invalid name: must start with alphanumeric, contain only letters, digits, dots, underscores, or dashes",
        );
        return;
      }
      renameSession(selected.session.id, trimmed);
      setMode("browse");
      refresh();
    },
    [selected, setError, setMode, refresh],
  );

  const handleMoveSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim().replace(/^\/+|\/+$/g, "");
      if (!trimmed || !selected) return;
      try {
        const groupId = getOrCreateGroupPath(trimmed);
        moveSession(selected.session.id, groupId);
        setMode("browse");
        refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [selected, setMode, refresh, setError],
  );

  return {
    handleResume,
    handleArchiveToggle,
    handleConfirmDelete,
    handleStartRename,
    handleStartMove,
    handleStartCreate,
    cancelToBrowse,
    handleCreateSubmit,
    handleRenameSubmit,
    handleMoveSubmit,
  } as const;
}
