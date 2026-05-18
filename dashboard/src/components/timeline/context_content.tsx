import { Badge, Group, Progress, Stack } from "@uiid/design-system";

import type { EventRow } from "../../api/types";
import {
  formatTokens,
  modelLabel,
  parseToken,
  remainingColor,
} from "../../lib/format";

type ContextContentProps = {
  event: EventRow;
};

export function ContextContent({ event }: ContextContentProps) {
  const meta = event.meta as Record<string, unknown> | null;
  if (!meta) return null;

  const remaining = parseToken(meta.remaining_pct);
  const total = parseToken(meta.context_window_tokens);
  const input = parseToken(meta.input_tokens);
  const cacheRead = parseToken(meta.cache_read_tokens);
  const cacheCreation = parseToken(meta.cache_creation_tokens);
  const model = modelLabel(meta.model as string | undefined);

  if (total === 0) return null;

  return (
    <Stack data-slot="context-content" gap={3} fullwidth>
      <Progress
        value={remaining}
        size="small"
        color={remainingColor(remaining)}
      />
      <Group gap={2}>
        {model && <Badge size="small">{model}</Badge>}
        {input > 0 && (
          <Badge
            size="small"
            color="orange"
          >{`${formatTokens(input)} input`}</Badge>
        )}
        {cacheRead > 0 && (
          <Badge
            size="small"
            color="blue"
          >{`${formatTokens(cacheRead)} cache read`}</Badge>
        )}
        {cacheCreation > 0 && (
          <Badge
            size="small"
            color="indigo"
          >{`${formatTokens(cacheCreation)} cache write`}</Badge>
        )}
      </Group>
    </Stack>
  );
}
ContextContent.displayName = "ContextContent";
