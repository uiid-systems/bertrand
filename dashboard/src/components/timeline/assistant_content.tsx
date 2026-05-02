import { Accordion, Stack } from "@uiid/design-system";

import type { EventRow } from "../../api/types";
import { Markdown } from "../markdown";

type AssistantContentProps = {
  event: EventRow;
};

export function AssistantContent({ event }: AssistantContentProps) {
  const meta = event.meta as Record<string, unknown> | null;
  const text = (meta?.text as string) ?? "";
  const thinking = (meta?.thinking as string) ?? "";

  if (!text && !thinking) return null;

  return (
    <Stack gap={2} maxw={680}>
      {text && <Markdown>{text}</Markdown>}
      {thinking && (
        <Accordion
          items={[
            {
              value: "thinking",
              trigger: "Thinking",
              content: <Markdown>{thinking}</Markdown>,
            },
          ]}
        />
      )}
    </Stack>
  );
}
AssistantContent.displayName = "AssistantContent";
