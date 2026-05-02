import { Accordion, Stack, Text } from "@uiid/design-system";

import type { EventRow } from "../../api/types";

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
      {text && (
        <Text size={1} style={{ whiteSpace: "pre-wrap" }}>
          {text}
        </Text>
      )}
      {thinking && (
        <Accordion
          items={[
            {
              value: "thinking",
              trigger: "Thinking",
              content: (
                <Text
                  size={-1}
                  family="mono"
                  shade="muted"
                  style={{ whiteSpace: "pre-wrap" }}
                >
                  {thinking}
                </Text>
              ),
            },
          ]}
        />
      )}
    </Stack>
  );
}
AssistantContent.displayName = "AssistantContent";
