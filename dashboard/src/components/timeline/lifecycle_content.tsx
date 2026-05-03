import { Badge, Card, Group, Stack } from "@uiid/design-system";

import type { EventRow } from "../../api/types";
import { Markdown } from "../markdown";

type LifecycleContentProps = {
  event: EventRow;
};

function modelLabel(model: string | undefined): string | undefined {
  if (!model) return undefined;
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

function shortId(id: string | undefined): string | undefined {
  if (!id) return undefined;
  return id.slice(0, 8);
}

export function LifecycleContent({ event }: LifecycleContentProps) {
  const meta = event.meta as Record<string, unknown> | null;

  if (event.event === "session.recap") {
    const recap = meta?.recap as string | undefined;
    if (!recap) return null;
    return (
      <Stack py={4}>
        <Card>
          <Markdown>{recap}</Markdown>
        </Card>
      </Stack>
    );
  }

  const claudeId =
    (meta?.claude_id as string | undefined) ??
    event.conversationId ??
    undefined;
  const model = modelLabel(meta?.model as string | undefined);
  const id = shortId(claudeId ?? undefined);
  const exitCode =
    event.event === "claude.ended" ? (meta?.exit_code as number | undefined) : undefined;
  const showExit = typeof exitCode === "number" && exitCode !== 0;

  if (!model && !id && !showExit) return null;

  return (
    <Group gap={2} ay="center">
      {model && (
        <Badge color="orange" size="small">
          {model}
        </Badge>
      )}
      {id && (
        <Badge color="neutral" size="small">
          {id}
        </Badge>
      )}
      {showExit && (
        <Badge color="red" size="small">
          {`exit ${exitCode}`}
        </Badge>
      )}
    </Group>
  );
}
LifecycleContent.displayName = "LifecycleContent";
