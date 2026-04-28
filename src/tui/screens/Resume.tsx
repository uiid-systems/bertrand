import { useState } from "react";
import { Box, Text, useInput, useTui } from "@orchetron/storm";
import { getSession } from "@/db/queries/sessions";
import { getConversationsBySession } from "@/db/queries/conversations";
import { formatAgo, formatDuration } from "@/lib/format";

export type ResumeSelection =
  | { type: "conversation"; conversationId: string }
  | { type: "new" }
  | { type: "back" };

interface ResumeProps {
  sessionId: string;
  onSelect: (selection: ResumeSelection) => void;
}

export function Resume({ sessionId, onSelect }: ResumeProps) {
  const { exit } = useTui();
  const [cursor, setCursor] = useState(0);

  const session = getSession(sessionId);
  const conversations = getConversationsBySession(sessionId);

  // +1 for "New conversation" option at the top
  const totalOptions = conversations.length + 1;

  const select = (selection: ResumeSelection) => {
    onSelect(selection);
    exit();
  };

  useInput((e) => {
    if (e.key === "c" && e.ctrl) select({ type: "back" });

    if (e.key === "up" || e.key === "k") {
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "down" || e.key === "j") {
      setCursor((c) => Math.min(totalOptions - 1, c + 1));
    } else if (e.key === "return") {
      if (cursor === 0) {
        select({ type: "new" });
      } else {
        const conv = conversations[cursor - 1]!;
        select({ type: "conversation", conversationId: conv.id });
      }
    } else if (e.key === "escape" || e.key === "q") {
      select({ type: "back" });
    }
  });

  if (!session) {
    return <Text color="red">Session not found</Text>;
  }

  return (
    <Box flexDirection="column" padding={1} gap={1}>
      <Text bold color="#82AAFF">
        Resume: {session.name}
      </Text>

      <Box flexDirection="column">
        {/* New conversation option */}
        <Box flexDirection="row" gap={1}>
          <Text>{cursor === 0 ? "❯" : " "}</Text>
          <Text bold={cursor === 0} color="#34D399">+ New conversation</Text>
        </Box>

        {/* Existing conversations */}
        {conversations.map((conv, i) => {
          const idx = i + 1;
          const isSelected = cursor === idx;
          const duration = conv.endedAt
            ? formatDuration(new Date(conv.endedAt).getTime() - new Date(conv.startedAt).getTime())
            : "active";
          const ago = formatAgo(conv.startedAt);

          return (
            <Box key={conv.id} flexDirection="row" gap={1}>
              <Text>{isSelected ? "❯" : " "}</Text>
              <Text bold={isSelected} dim={conv.discarded}>
                {conv.id.slice(0, 8)}
              </Text>
              <Text dim>{ago}</Text>
              <Text dim>·</Text>
              <Text dim>{conv.eventCount} events</Text>
              <Text dim>·</Text>
              <Text dim>{duration}</Text>
              {conv.discarded && <Text color="red" dim>(discarded)</Text>}
            </Box>
          );
        })}
      </Box>

      <Box>
        <Text dim>{"↑↓ navigate · enter select · q back"}</Text>
      </Box>
    </Box>
  );
}
