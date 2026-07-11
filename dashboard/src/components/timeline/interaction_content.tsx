import { List, Stack, Tabs, Text, type TabProps } from "@uiid/design-system";

import type { EventRow } from "../../api/types";
import { Markdown } from "../markdown";

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

type InteractionContentProps = Readonly<{
  event: EventRow;
}>;

function findQuestion(
  questions: QuestionDef[] | undefined,
  question: string,
): QuestionDef | undefined {
  return questions?.find((q) => q.question === question);
}

/**
 * AskUserQuestion answer shapes (Claude Code 2.1.123+):
 *   1. Selection only           → answer = "Label"  or  "L1, L2, …"
 *   2. Selection(s) + note      → answer = "Label, note text"  or  "L1, L2, …, note text"
 *   3. Other-only (typed text)  → answer = "typed text" (matches no option label)
 *
 * Older Claude Code (≤ 2.1.107) also emitted an `annotations` field carrying
 * the note separately. Newer versions dropped it, so we recover picks + note
 * by greedily matching option labels from the start of the answer string.
 * Labels are tried longest-first so a label that prefixes another doesn't
 * shadow it; whatever remains after the last match is the trailing note.
 */
function parseAnswer(
  answer: string,
  options: QuestionOption[],
  multiSelect: boolean,
): { selectedLabels: string[]; note: string | undefined } {
  const sorted = [...options].sort((a, b) => b.label.length - a.label.length);
  const selectedLabels: string[] = [];
  let remaining = answer;

  while (remaining) {
    const match = sorted.find(
      (o) => remaining === o.label || remaining.startsWith(o.label + ", "),
    );
    if (!match) break;
    selectedLabels.push(match.label);
    if (remaining === match.label) {
      remaining = "";
      break;
    }
    remaining = remaining.slice(match.label.length + 2);
    if (!multiSelect) break;
  }

  return { selectedLabels, note: remaining || undefined };
}

export function InteractionContent({ event }: InteractionContentProps) {
  const meta = event.meta as Record<string, unknown> | null;

  if (event.event === "session.answered") {
    const answers = meta?.answers as Record<string, string> | undefined;
    if (!answers || Object.keys(answers).length === 0) return null;

    const questions = meta?.questions as QuestionDef[] | undefined;

    const entries = Object.entries(answers);

    const renderQuestionBody = (question: string, answer: string) => {
      const qDef = findQuestion(questions, question);
      const multiSelect = qDef?.multiSelect ?? false;
      const options = qDef?.options ?? [];
      const { selectedLabels, note } = parseAnswer(
        answer,
        options,
        multiSelect,
      );
      const hasSelection = selectedLabels.length > 0;
      const manualAnswer = !hasSelection ? (note ?? answer) : undefined;
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
              marker="decimal"
              items={options.map((o) => {
                const selected = selectedLabels.includes(o.label);
                return {
                  label: (
                    <Text
                      weight="bold"
                      color={selected ? "green" : undefined}
                      shade={selected ? undefined : "muted"}
                    >
                      {o.label}
                    </Text>
                  ),
                  description: o.description,
                };
              })}
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
      return renderQuestionBody(question, answer);
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
      <Tabs
        items={tabs}
        size="sm"
        ContainerProps={{ mt: 6 }}
        ListProps={{ style: { backgroundColor: "var(--shade-background)" } }}
      />
    );
  }

  if (event.event === "user.prompt") {
    const prompt = meta?.prompt as string | undefined;
    if (!prompt) return null;

    return <Markdown>{prompt}</Markdown>;
  }

  return null;
}
InteractionContent.displayName = "InteractionContent";
