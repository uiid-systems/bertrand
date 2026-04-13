import { useState, useCallback } from "react";

import { Box, Text, useTui } from "@orchetron/storm";

import { SessionRow } from "@/tui/components/SessionRow";
import { Logo } from "@/tui/components/BertrandLogo";
import { Create } from "./create";
import { Rename } from "./rename";
import { Move } from "./move";
import { ConfirmDelete } from "./confirm-delete";

import type { LaunchSelection, LaunchProps, Mode } from "./launch.types";
import { formatBindings } from "./launch.utils";
import { useLaunchSessions } from "./use-launch-sessions";
import { useLaunchActions } from "./use-launch-actions";
import { useLaunchHotkeys } from "./use-launch-hotkeys";

export function Launch({ onSelect }: LaunchProps) {
  const { exit } = useTui();
  const [mode, setMode] = useState<Mode>("browse");
  const [newName, setNewName] = useState("");
  const [editValue, setEditValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const {
    sessionRows,
    selected,
    cursor,
    setCursor,
    showArchived,
    toggleArchived,
    refresh,
  } = useLaunchSessions();

  const select = useCallback(
    (selection: LaunchSelection) => {
      onSelect(selection);
      exit();
    },
    [onSelect, exit],
  );

  const actions = useLaunchActions({
    selected,
    select,
    refresh,
    setMode,
    setCursor,
    setNewName,
    setEditValue,
    setError,
  });

  const {
    browseBindings,
    inputBindings,
    deleteBindings,
    escPending,
    clearEscPending,
  } = useLaunchHotkeys({
    mode,
    selected,
    sessionCount: sessionRows.length,
    quit: () => select({ type: "quit" }),
    setCursor,
    toggleArchived,
    setMode,
    ...actions,
  });

  // --- Render ---

  if (mode === "confirm-delete" && selected) {
    return (
      <ConfirmDelete
        sessionName={`${selected.groupPath}/${selected.session.slug}`}
        deleteBindings={deleteBindings}
      />
    );
  }

  if (mode === "rename" && selected) {
    return (
      <Rename
        editValue={editValue}
        setEditValue={setEditValue}
        setError={setError}
        handleRenameSubmit={actions.handleRenameSubmit}
        inputBindings={inputBindings}
        error={error}
        escPending={escPending}
        clearEscPending={clearEscPending}
        placeholder={selected.session.slug}
      />
    );
  }

  if (mode === "move" && selected) {
    return (
      <Move
        editValue={editValue}
        setEditValue={setEditValue}
        setError={setError}
        handleMoveSubmit={actions.handleMoveSubmit}
        inputBindings={inputBindings}
        error={error}
        escPending={escPending}
        clearEscPending={clearEscPending}
        placeholder={selected.groupPath}
      />
    );
  }

  if (mode === "create") {
    return (
      <Create
        newName={newName}
        setNewName={setNewName}
        setError={setError}
        handleCreateSubmit={actions.handleCreateSubmit}
        inputBindings={inputBindings}
        error={error}
        escPending={escPending}
        clearEscPending={clearEscPending}
      />
    );
  }

  return (
    <Box flexDirection="column" padding={1} gap={1}>
      <Box>
        <Logo />
      </Box>

      {sessionRows.length === 0 ? (
        <Box flexDirection="column">
          <Text dim>
            {showArchived ? "No sessions." : "No active sessions."}
          </Text>
          <Box flexDirection="row">
            <Text dim>Press </Text>
            <Text bold>n</Text>
            <Text dim> to create one</Text>
            {!showArchived && (
              <>
                <Text dim> · </Text>
                <Text bold>tab</Text>
                <Text dim> to show archived</Text>
              </>
            )}
          </Box>
        </Box>
      ) : (
        sessionRows.map((row, i) => (
          <SessionRow
            key={row.session.id}
            name={`${row.groupPath}/${row.session.slug}`}
            status={row.session.status}
            updatedAt={row.session.updatedAt}
            selected={i === cursor}
          />
        ))
      )}

      <Box>
        <Text dim>{formatBindings(browseBindings)}</Text>
      </Box>
    </Box>
  );
}
