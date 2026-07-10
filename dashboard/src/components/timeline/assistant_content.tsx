import { Stack } from "@uiid/design-system";

import type { EventRow } from "../../api/types";
import { Markdown } from "../markdown";
import { EventCard } from "./event_card";

type AssistantContentProps = Readonly<{
  event: EventRow;
}>;

export const AssistantContent = ({ event }: AssistantContentProps) => {
  const meta = event.meta as Record<string, unknown> | null;
  const text = ((meta?.text as string) ?? "").trim();

  if (!text) return null;

  return (
    <EventCard>
      <Stack data-slot="assistant-content" gap={2}>
        {text && <Markdown>{text}</Markdown>}
      </Stack>
    </EventCard>
  );
};
AssistantContent.displayName = "AssistantContent";
