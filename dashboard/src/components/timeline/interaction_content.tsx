import { Card, Stack, Text } from "@uiid/design-system";

import type { EventRow } from "../../api/types";

type Annotation = { notes?: string; preview?: string };

type InteractionContentProps = {
  event: EventRow;
};

/**
 * AskUserQuestion concatenates the user's free-text note onto the answer string
 * (as ", <note>"), and also stores it on annotations[question].notes. The note
 * portion in the answer is sometimes truncated by a character or two compared
 * to annotations.notes, so we walk back to find the longest prefix of ", <note>"
 * that the answer ends with — strip that and render the note from annotations.
 */
function splitSelectionAndNote(answer: string, note: string | undefined) {
  if (!note) return { selection: answer, note: undefined };
  const fullSuffix = `, ${note}`;
  const maxLen = Math.min(fullSuffix.length, answer.length);
  for (let len = maxLen; len >= 4; len--) {
    const tail = answer.slice(-len);
    if (fullSuffix.startsWith(tail)) {
      return { selection: answer.slice(0, -len), note };
    }
  }
  return { selection: answer, note };
}

export function InteractionContent({ event }: InteractionContentProps) {
  const meta = event.meta as Record<string, unknown> | null;

  if (event.event === "session.answered") {
    const answers = meta?.answers as Record<string, string> | undefined;
    if (!answers || Object.keys(answers).length === 0) return null;

    const annotations = meta?.annotations as
      | Record<string, Annotation>
      | undefined;

    return (
      <Stack gap={2} maxw={560} py={4}>
        {Object.entries(answers).map(([question, answer]) => {
          const { selection, note } = splitSelectionAndNote(
            answer,
            annotations?.[question]?.notes,
          );
          return (
            <Card key={question} gap={4}>
              <Text size={1} weight="bold">
                {selection}
              </Text>
              {note && (
                <Text shade="muted" style={{ fontStyle: "italic" }}>
                  <strong style={{ textTransform: "uppercase" }}>Note:</strong>{" "}
                  {note}
                </Text>
              )}
            </Card>
          );
        })}
      </Stack>
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
