import { Stack } from "@uiid/design-system";

import type { EventRow } from "../../api/types";
import { Markdown } from "../markdown";

type AssistantContentProps = Readonly<{
  event: EventRow;
}>;

export const AssistantContent = ({ event }: AssistantContentProps) => {
  const meta = event.meta as Record<string, unknown> | null;
  const text = ((meta?.text as string) ?? "").trim();

  if (!text) return null;

  return (
    <Stack data-slot="assistant-content" gap={2} fullwidth>
      <Markdown>{text}</Markdown>
    </Stack>
  );
};
AssistantContent.displayName = "AssistantContent";
