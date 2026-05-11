import { Badge, Stack } from "@uiid/design-system";

import type { EventRow } from "../../api/types";
import { Markdown } from "../markdown";

type AssistantContentProps = {
  event: EventRow;
};

function thoughtDots(bytes: number): string {
  if (bytes < 1500) return "●○○";
  if (bytes < 5000) return "●●○";
  return "●●●";
}

const RECAP_TAG_RE = /<recap>[\s\S]*?<\/recap>/gi;

export function AssistantContent({ event }: AssistantContentProps) {
  const meta = event.meta as Record<string, unknown> | null;
  const rawText = (meta?.text as string) ?? "";
  const text = rawText.replace(RECAP_TAG_RE, "").trim();
  const thinkingBlocks = (meta?.thinkingBlocks as number) ?? 0;
  const thinkingBytes = (meta?.thinkingBytes as number) ?? 0;

  if (!text && thinkingBlocks === 0) return null;

  return (
    <Stack data-slot="assistant-content" gap={2} maxw={680}>
      {thinkingBlocks > 0 && (
        <Badge color="indigo">{`Thought ${thoughtDots(thinkingBytes)}`}</Badge>
      )}
      {text && <Markdown>{text}</Markdown>}
    </Stack>
  );
}
AssistantContent.displayName = "AssistantContent";
