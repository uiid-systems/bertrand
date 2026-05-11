import {
  Card,
  List,
  Stack,
  Tabs,
  Text,
  type TabProps,
} from "@uiid/design-system";

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
 * AskUserQuestion answer shapes:
 *   1. Selection only           → answer = "Label",            annotations = {}
 *   2. Selection + note         → answer = "Label, note text", annotations.notes = "note text"
 *   3. Other-only (typed text)  → answer = "typed text",       annotations = {}
 *
 * For (2) the note in the answer is sometimes truncated by a character or two
 * vs. annotations.notes, so we walk back to find the longest suffix of ", <note>"
 * that the answer ends with and strip it. For (1) and (3), annotations is empty
 * and we leave the answer untouched — the caller decides whether the resulting
 * selection matches a real option (case 1) or is a manual answer (case 3).
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

    const entries = Object.entries(answers);

    const renderQuestionBody = (question: string, answer: string) => {
      const { selection, note } = splitSelectionAndNote(
        answer,
        annotations?.[question]?.notes,
      );
      const qDef = findQuestion(questions, question);
      const multiSelect = qDef?.multiSelect ?? false;
      const options = qDef?.options ?? [];
      const hasSelection = options.some((o) =>
        isPicked(o.label, selection, multiSelect),
      );
      const manualAnswer =
        !hasSelection && selection.trim() ? selection : note;
      const additionalNote = hasSelection ? note : undefined;

      return (
        <Stack gap={4} fullwidth>
          {manualAnswer && (
            <Stack data-slot="interaction-content-note" gap={4} m={2} fullwidth>
              <Text color="yellow" weight="bold" size={1}>
                Answered manually:
              </Text>
              <Markdown>{manualAnswer}</Markdown>
            </Stack>
          )}
          {!hasSelection && !manualAnswer && (
            <Text color="red" weight="bold" size={1} m={2}>
              Didn't answer.
            </Text>
          )}
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
          {additionalNote && (
            <Stack data-slot="interaction-content-note" gap={4} m={2} fullwidth>
              <Text color="green" weight="bold" size={1}>
                Additional notes:
              </Text>
              <Markdown>{additionalNote}</Markdown>
            </Stack>
          )}
        </Stack>
      );
    };

    if (entries.length === 1) {
      const [question, answer] = entries[0];
      return (
        <Stack data-slot="interaction-content" gap={2} py={4} fullwidth>
          <Card gap={4} fullwidth>
            {renderQuestionBody(question, answer)}
          </Card>
        </Stack>
      );
    }

    const tabs: TabProps[] = entries.map(([question, answer], i) => {
      const qDef = findQuestion(questions, question);
      return {
        label: qDef?.header ?? `Question ${i + 1}`,
        value: question,
        render: renderQuestionBody(question, answer),
      };
    });

    return (
      <Stack data-slot="interaction-content" gap={2} py={4} fullwidth>
        <Card gap={4} fullwidth>
          <Tabs
            items={tabs}
            size="sm"
            // fullwidth
            ContainerProps={{ fullwidth: true, mt: 6 }}
          />
        </Card>
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
