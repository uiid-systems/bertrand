import { useState, useCallback } from "react";

import { Box, Text, TextInput, useInput, useTui } from "@orchetron/storm";

import { SessionRow } from "../components/SessionRow.tsx";
import {
  getAllSessions,
  updateSessionStatus,
  renameSession,
  moveSession,
  deleteSession,
} from "../../db/queries/sessions.ts";
import { getGroupsByParent } from "../../db/queries/groups.ts";
import { getOrCreateGroupPath } from "../../db/queries/groups.ts";
import { Logo } from "../components/BertrandLogo.tsx";
import { parseSessionName } from "../../lib/parse-session-name.ts";
import { getConversationsBySession } from "../../db/queries/conversations.ts";

export type LaunchSelection =
  | { type: "create"; groupPath: string; slug: string }
  | { type: "resume"; sessionId: string; conversationId: string }
  | { type: "pick"; sessionId: string }
  | { type: "quit" };

interface LaunchProps {
  onSelect: (selection: LaunchSelection) => void;
}

type Mode = "browse" | "create" | "confirm-delete" | "rename" | "move";

export function Launch({ onSelect }: LaunchProps) {
  const { exit } = useTui();
  const [mode, setMode] = useState<Mode>("browse");
  const [cursor, setCursor] = useState(0);
  const [showArchived, setShowArchived] = useState(false);
  const [newName, setNewName] = useState("");
  const [editValue, setEditValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const sessionRows = getAllSessions(showArchived ? undefined : { excludeArchived: true });
  const selected = sessionRows[cursor];

  const select = (selection: LaunchSelection) => {
    onSelect(selection);
    exit();
  };

  useInput((e) => {
    if (e.key === "c" && e.ctrl) select({ type: "quit" });

    if (mode === "browse") {
      if (e.key === "up" || e.key === "k") {
        setCursor((c) => Math.max(0, c - 1));
      } else if (e.key === "down" || e.key === "j") {
        setCursor((c) => Math.min(sessionRows.length - 1, c + 1));
      } else if (e.key === "return" && selected) {
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
      } else if (e.key === "n") {
        setMode("create");
        setNewName("");
        setError(null);
      } else if (e.key === "a" && selected) {
        // Archive/unarchive toggle
        const newStatus = selected.session.status === "archived" ? "paused" : "archived";
        updateSessionStatus(selected.session.id, newStatus);
        refresh();
      } else if (e.key === "d" && selected) {
        setMode("confirm-delete");
      } else if (e.key === "r" && selected) {
        setMode("rename");
        setEditValue(selected.session.slug);
        setError(null);
      } else if (e.key === "m" && selected) {
        setMode("move");
        setEditValue(selected.groupPath);
        setError(null);
      } else if (e.key === "tab") {
        setShowArchived((s) => !s);
        setCursor(0);
      } else if (e.key === "q") {
        select({ type: "quit" });
      }
    } else if (mode === "confirm-delete") {
      if (e.key === "y" && selected) {
        deleteSession(selected.session.id);
        setCursor((c) => Math.max(0, c - 1));
        setMode("browse");
        refresh();
      } else {
        setMode("browse");
      }
    }
  });

  // Confirm delete overlay
  if (mode === "confirm-delete" && selected) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="red">Delete session?</Text>
        <Box height={1} />
        <Text>
          This will permanently delete{" "}
          <Text bold>{selected.groupPath}/{selected.session.slug}</Text>
          {" "}and all its conversations and events.
        </Text>
        <Box height={1} />
        <Text dim>y to confirm · any other key to cancel</Text>
      </Box>
    );
  }

  // Rename mode
  if (mode === "rename" && selected) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="#82AAFF">Rename session</Text>
        <Box height={1} />
        <Text>New name: </Text>
        <TextInput
          value={editValue}
          onChange={(v: string) => {
            setEditValue(v);
            setError(null);
          }}
          onSubmit={(value: string) => {
            const trimmed = value.trim();
            if (!trimmed) return;
            if (!/^[a-z0-9][a-z0-9._-]*$/i.test(trimmed)) {
              setError("Invalid name: must start with alphanumeric, contain only letters, digits, dots, underscores, or dashes");
              return;
            }
            renameSession(selected.session.id, trimmed);
            setMode("browse");
            refresh();
          }}
          placeholder={selected.session.slug}
        />
        {error && (
          <>
            <Box height={1} />
            <Text color="red">{error}</Text>
          </>
        )}
        <Box height={1} />
        <Text dim>Enter to save · Esc to cancel</Text>
      </Box>
    );
  }

  // Move mode
  if (mode === "move" && selected) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="#82AAFF">Move session</Text>
        <Box height={1} />
        <Text>New group path: </Text>
        <TextInput
          value={editValue}
          onChange={(v: string) => {
            setEditValue(v);
            setError(null);
          }}
          onSubmit={(value: string) => {
            const trimmed = value.trim().replace(/^\/+|\/+$/g, "");
            if (!trimmed) return;
            try {
              const groupId = getOrCreateGroupPath(trimmed);
              moveSession(selected.session.id, groupId);
              setMode("browse");
              refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
          placeholder={selected.groupPath}
        />
        {error && (
          <>
            <Box height={1} />
            <Text color="red">{error}</Text>
          </>
        )}
        <Box height={1} />
        <Text dim>Enter to move · Esc to cancel</Text>
      </Box>
    );
  }

  // Create mode
  if (mode === "create") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="#82AAFF">New Session</Text>
        <Box height={1} />
        <Text>Name: </Text>
        <TextInput
          value={newName}
          onChange={(v: string) => {
            setNewName(v);
            setError(null);
          }}
          onSubmit={(value: string) => {
            if (!value.trim()) return;
            try {
              const { groupPath, slug } = parseSessionName(value);
              select({ type: "create", groupPath, slug });
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
          placeholder="group/session-name"
        />
        {error && (
          <>
            <Box height={1} />
            <Text color="red">{error}</Text>
          </>
        )}
        <Box height={1} />
        <Text dim>Enter to create · Esc to cancel</Text>
      </Box>
    );
  }

  // Browse mode
  return (
    <Box flexDirection="column" padding={1} gap={1}>
      <Box>
        <Logo />
      </Box>

      {sessionRows.length === 0 ? (
        <Box flexDirection="column">
          <Text dim>{showArchived ? "No sessions." : "No active sessions."}</Text>
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
        <Text dim>{"↑↓ navigate · enter resume · n new · a archive · d delete · r rename · m move · tab filter · q quit"}</Text>
      </Box>
    </Box>
  );
}
