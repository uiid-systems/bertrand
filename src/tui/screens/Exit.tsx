import { useState } from "react";
import { Box, Text, useInput, useTui } from "@orchetron/storm";
import { getSession } from "../../db/queries/sessions.ts";
import { getConversationsBySession } from "../../db/queries/conversations.ts";
import { formatDuration } from "../../lib/format.ts";
import { StatusDot } from "../components/StatusDot.tsx";

type ExitAction = "save" | "archive" | "discard" | "resume";

interface ExitOption {
  action: ExitAction;
  label: string;
  hint: string;
}

const OPTIONS: ExitOption[] = [
  { action: "save", label: "Save", hint: "Keep session paused for later" },
  { action: "archive", label: "Archive", hint: "Mark as done, hide from active view" },
  { action: "discard", label: "Discard", hint: "Delete this session permanently" },
  { action: "resume", label: "Resume", hint: "Start a new conversation in this session" },
];

interface ExitProps {
  sessionId: string;
  onAction: (action: ExitAction, sessionId: string) => void;
}

export function Exit({ sessionId, onAction }: ExitProps) {
  const { exit } = useTui();
  const [cursor, setCursor] = useState(0);

  const session = getSession(sessionId);
  const conversations = session ? getConversationsBySession(session.id) : [];

  useInput((e) => {
    if (e.key === "c" && e.ctrl) exit();

    if (e.key === "up" || e.key === "k") {
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "down" || e.key === "j") {
      setCursor((c) => Math.min(OPTIONS.length - 1, c + 1));
    } else if (e.key === "return") {
      const selected = OPTIONS[cursor]!;
      exit();
      onAction(selected.action, sessionId);
    } else if (e.key === "q") {
      exit();
      onAction("save", sessionId);
    }
  });

  if (!session) {
    return <Text color="red">Session not found</Text>;
  }

  const duration = session.endedAt && session.startedAt
    ? formatDuration(new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime())
    : null;

  return (
    <Box flexDirection="column" padding={1} gap={1}>
      <Text bold color="#82AAFF">Session ended</Text>

      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <StatusDot status={session.status} />
          <Text bold>{session.name}</Text>
          {duration && <Text dim>({duration})</Text>}
        </Box>
        <Text dim>{conversations.length} conversation{conversations.length !== 1 ? "s" : ""}</Text>
      </Box>

      <Box flexDirection="column">
        {OPTIONS.map((opt, i) => (
          <Box key={opt.action} flexDirection="row" gap={1}>
            <Text>{i === cursor ? "❯" : " "}</Text>
            <Text bold={i === cursor}>{opt.label}</Text>
            <Text dim>{opt.hint}</Text>
          </Box>
        ))}
      </Box>

      <Box>
        <Text dim>↑↓ navigate · enter select · q save & quit</Text>
      </Box>
    </Box>
  );
}

export type { ExitAction };
