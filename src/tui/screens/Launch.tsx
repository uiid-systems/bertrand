import { useState } from "react";

import { Box, Text, TextInput, useInput, useTui } from "@orchetron/storm";

import { SessionRow } from "../components/SessionRow.tsx";
import { getAllSessions } from "../../db/queries/sessions.ts";
import { getGroupsByParent } from "../../db/queries/groups.ts";
import { Logo } from "../components/BertrandLogo.tsx";
import { parseSessionName } from "../../lib/parse-session-name.ts";
import { launch, resume } from "../../engine/session.ts";
import { getConversationsBySession } from "../../db/queries/conversations.ts";

type Mode = "browse" | "create";

export function Launch() {
  const { exit } = useTui();
  const [mode, setMode] = useState<Mode>("browse");
  const [cursor, setCursor] = useState(0);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const sessionRows = getAllSessions({ excludeArchived: true });
  const groups = getGroupsByParent(null);

  useInput((e) => {
    if (e.key === "c" && e.ctrl) exit();

    if (mode === "browse") {
      if (e.key === "up" || e.key === "k") {
        setCursor((c) => Math.max(0, c - 1));
      } else if (e.key === "down" || e.key === "j") {
        setCursor((c) => Math.min(sessionRows.length - 1, c + 1));
      } else if (e.key === "return" && sessionRows.length > 0) {
        const selected = sessionRows[cursor];
        if (selected) {
          const conversations = getConversationsBySession(selected.session.id);
          if (conversations.length > 0) {
            const mostRecent = conversations[0]!;
            exit();
            resume({ sessionId: selected.session.id, conversationId: mostRecent.id });
          }
          // TODO: if no conversations, start a new one (ELKY-122 resume picker)
        }
      } else if (e.key === "n") {
        setMode("create");
      } else if (e.key === "q") {
        exit();
      }
    }
  });

  if (mode === "create") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="#82AAFF">
          New Session
        </Text>
        <Box height={1} />
        <Text>Name: </Text>
        <TextInput
          value={newName}
          onChange={(v: string) => {
            setNewName(v);
            setError(null);
          }}
          onSubmit={async (value: string) => {
            if (!value.trim()) return;
            try {
              const { groupPath, slug } = parseSessionName(value);
              exit();
              await launch({ groupPath, slug });
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

  return (
    <Box flexDirection="column" padding={1} gap={1}>
      <Box>
        <Logo />
      </Box>

      {sessionRows.length === 0 ? (
        <Box flexDirection="column">
          <Text dim>No sessions yet.</Text>
          <Box flexDirection="row">
            <Text dim>Press </Text>
            <Text bold>n</Text>
            <Text dim> to create one.</Text>
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
        <Text dim>↑↓ navigate · enter select · n new · q quit</Text>
      </Box>
    </Box>
  );
}
