import { Badge, Group, Progress, Stack } from "@uiid/design-system";

import type { EventRow } from "../../api/types";
import type { TimelineColor } from "../../lib/timeline/categories";

type ContextContentProps = {
  event: EventRow;
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function remainingColor(remainingPct: number): TimelineColor {
  if (remainingPct <= 25) return "red";
  if (remainingPct <= 50) return "yellow";
  return "green";
}

function modelLabel(model: string | undefined): string | undefined {
  if (!model) return undefined;
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

function parseToken(value: unknown): number {
  const n = parseInt((value as string) ?? "0", 10);
  return Number.isFinite(n) ? n : 0;
}

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
    <Stack gap={3} fullwidth>
      <Progress value={remaining} size="small" color={remainingColor(remaining)} />
      <Group gap={2}>
        {model && <Badge size="small">{model}</Badge>}
        {input > 0 && (
          <Badge size="small" color="orange">{`${formatTokens(input)} input`}</Badge>
        )}
        {cacheRead > 0 && (
          <Badge size="small" color="blue">{`${formatTokens(cacheRead)} cache read`}</Badge>
        )}
        {cacheCreation > 0 && (
          <Badge size="small" color="indigo">{`${formatTokens(cacheCreation)} cache write`}</Badge>
        )}
      </Group>
    </Stack>
  );
}
ContextContent.displayName = "ContextContent";
