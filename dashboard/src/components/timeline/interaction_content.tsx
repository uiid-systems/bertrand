import { Card, List, Stack, Text } from "@uiid/design-system";

import type { EventRow } from "../../api/types";
import { Markdown } from "../markdown";

type Annotation = { notes?: string; preview?: string };

type QuestionOption = {
  label: string;
  description?: string;
  preview?: string;
};

type QuestionDef = {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: QuestionOption[];
};

type InteractionContentProps = {
  event: EventRow;
};

function findQuestion(
  questions: QuestionDef[] | undefined,
  question: string,
): QuestionDef | undefined {
  return questions?.find((q) => q.question === question);
}

function isPicked(label: string, selection: string, multiSelect: boolean) {
  if (!multiSelect) return label === selection;
  return selection.split(", ").includes(label);
}

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
    const questions = meta?.questions as QuestionDef[] | undefined;

    return (
      <Stack data-slot="interaction-content" gap={2} py={4} fullwidth>
        {Object.entries(answers).map(([question, answer]) => {
          const { selection, note } = splitSelectionAndNote(
            answer,
            annotations?.[question]?.notes,
          );
          const qDef = findQuestion(questions, question);
          const multiSelect = qDef?.multiSelect ?? false;
          const options = qDef?.options ?? [];
          return (
            <Card key={question} gap={4} fullwidth>
              {options.length > 0 && (
                <List
                  type="ordered"
                  items={options.map((o) => ({
                    value: o.label,
                    label: (
                      <Text
                        weight="bold"
                        color={
                          isPicked(o.label, selection, multiSelect)
                            ? "green"
                            : undefined
                        }
                      >
                        {o.label}
                      </Text>
                    ),
                    description: o.description,
                    disabled: !isPicked(o.label, selection, multiSelect),
                  }))}
                />
              )}
              {note && (
                <Stack
                  data-slot="interaction-content-note"
                  gap={4}
                  m={2}
                  fullwidth
                >
                  <Text color="green" weight="bold">
                    {options.length > 0
                      ? "Additional notes:"
                      : "Answered manually:"}
                  </Text>
                  <Markdown>{note}</Markdown>
                </Stack>
              )}
            </Card>
          );
        })}
      </Stack>
    );
  }

  if (event.event === "user.prompt") {
    const prompt = meta?.prompt as string | undefined;
    if (!prompt) return null;

    return (
      <Stack py={4}>
        <Card>
          <Markdown>{prompt}</Markdown>
        </Card>
      </Stack>
    );
  }

  return null;
}
InteractionContent.displayName = "InteractionContent";
