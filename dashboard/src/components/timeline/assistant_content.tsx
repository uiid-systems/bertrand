import { Badge, Stack } from "@uiid/design-system";

import type { EventRow } from "../../api/types";
import { Markdown } from "../markdown";
import { EventCard } from "./event_card";

type AssistantContentProps = {
  event: EventRow;
};

function thoughtDots(bytes: number): string {
  if (bytes < 1500) return "●○○";
  if (bytes < 5000) return "●●○";
  return "●●●";
}

export function AssistantContent({ event }: AssistantContentProps) {
  const meta = event.meta as Record<string, unknown> | null;

  const text = ((meta?.text as string) ?? "").trim();
  const thinkingBlocks = (meta?.thinkingBlocks as number) ?? 0;
  // const thinkingBytes = (meta?.thinkingBytes as number) ?? 0;

  if (!text && thinkingBlocks === 0) return null;

  return (
    <EventCard>
      <Stack data-slot="assistant-content" gap={2}>
        {/* {thinkingBlocks > 0 && (
          <Badge color="indigo">{`Thought ${thoughtDots(thinkingBytes)}`}</Badge>
        )} */}
        {text && <Markdown>{text}</Markdown>}
      </Stack>
    </EventCard>
  );
}
AssistantContent.displayName = "AssistantContent";
