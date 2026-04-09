import { useState } from "react";
import { Box, Text, TextInput, useInput, useTui } from "@orchetron/storm";
import { SessionRow } from "../components/SessionRow.tsx";
import { getAllSessions } from "../../db/queries/sessions.ts";
import { getGroupsByParent } from "../../db/queries/groups.ts";

type Mode = "browse" | "create";

export function Launch() {
  const { exit } = useTui();
  const [mode, setMode] = useState<Mode>("browse");
  const [cursor, setCursor] = useState(0);
  const [newName, setNewName] = useState("");

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
        // TODO: resume selected session via engine
        const selected = sessionRows[cursor];
        if (selected) exit();
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
        <Text bold color="#82AAFF">New Session</Text>
        <Box height={1} />
        <Text>Name: </Text>
        <TextInput
          value={newName}
          onChange={setNewName}
          onSubmit={(value: string) => {
            if (value.trim()) {
              // TODO: create session + launch Claude
              exit();
            }
          }}
          placeholder="my-session-name"
        />
        <Box height={1} />
        <Text dim>Enter to create · Esc to cancel</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="#82AAFF">bertrand</Text>
        <Text dim> — sessions</Text>
      </Box>

      {sessionRows.length === 0 ? (
        <Box flexDirection="column">
          <Text dim>No sessions yet.</Text>
          <Box height={1} />
          <Text dim>Press </Text>
          <Text bold>n</Text>
          <Text dim> to create one.</Text>
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

      <Box marginTop={1}>
        <Text dim>↑↓ navigate · enter select · n new · q quit</Text>
      </Box>
    </Box>
  );
}
