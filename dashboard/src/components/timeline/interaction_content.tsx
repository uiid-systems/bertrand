import { Text } from "@uiid/design-system";

import type { EventRow } from "../../api/types";

type InteractionContentProps = {
  event: EventRow;
};

export function InteractionContent({ event }: InteractionContentProps) {
  const meta = event.meta as Record<string, unknown> | null;

  if (event.event === "session.answered") {
    const answer = meta?.answer as string | undefined;
    if (!answer) return null;

    return (
      <Text
        weight="bold"
        py={4}
        shade="muted"
        style={{ maxWidth: 560, fontStyle: "italic" }}
      >
        {answer}
      </Text>
    );
  }

  if (event.event === "user.prompt") {
    const prompt = meta?.prompt as string | undefined;

    return prompt ? (
      <Text size={1} color="neutral">
        {prompt}
      </Text>
    ) : null;
  }

  return null;
}
InteractionContent.displayName = "InteractionContent";
