import {
  Card,
  Group,
  LANGUAGE_DISPLAY_NAMES,
  Stack,
  Text,
} from "@uiid/design-system";
import type { BundledLanguage } from "@uiid/design-system";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { DiffBlock } from "../../components/diff/diff-block";

const OLD_FIXTURE = `import { useState } from "react";

export function Counter() {
  const [count, setCount] = useState(0);

  function increment() {
    setCount(count + 1);
  }

  return (
    <button onClick={increment}>
      {count}
    </button>
  );
}
`;

const NEW_FIXTURE = `import { useCallback, useState } from "react";

type CounterProps = {
  step?: number;
};

export function Counter({ step = 1 }: CounterProps) {
  const [count, setCount] = useState(0);

  const increment = useCallback(() => {
    setCount((c) => c + step);
  }, [step]);

  return (
    <button type="button" onClick={increment}>
      count: {count}
    </button>
  );
}
`;

const TEXTAREA_STYLE: React.CSSProperties = {
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: 12,
  lineHeight: 1.5,
  padding: 12,
  minHeight: 280,
  border: "1px solid var(--color-border)",
  borderRadius: 4,
  background: "var(--color-surface)",
  color: "var(--color-text)",
  resize: "vertical",
};

const LANGUAGES = Object.entries(LANGUAGE_DISPLAY_NAMES) as Array<
  [BundledLanguage, string]
>;

function DiffDevPage() {
  const [oldStr, setOldStr] = useState(OLD_FIXTURE);
  const [newStr, setNewStr] = useState(NEW_FIXTURE);
  const [language, setLanguage] = useState<BundledLanguage>("tsx");
  const [wordDiff, setWordDiff] = useState(false);

  return (
    <Stack gap={4} p={6} fullwidth style={{ overflow: "auto" }}>
      <Stack gap={2}>
        <Text size={3} weight="bold">
          Diff kitchen sink
        </Text>
        <Text size={2} shade="muted">
          Edit the old and new sources on the left, see the diff on the right.
          Backed by jsdiff + the existing CodeBlock primitive.
        </Text>
      </Stack>

      <Group ay="center" gap={4}>
        <Group ay="center" gap={2}>
          <Text size={0} shade="muted">
            language
          </Text>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as BundledLanguage)}
            style={{
              fontSize: 12,
              padding: "4px 8px",
              border: "1px solid var(--color-border)",
              borderRadius: 4,
              background: "var(--color-surface)",
              color: "var(--color-text)",
            }}
          >
            {LANGUAGES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Group>
        <Group ay="center" gap={2}>
          <input
            id="word-diff"
            type="checkbox"
            checked={wordDiff}
            onChange={(e) => setWordDiff(e.target.checked)}
          />
          <Text size={0} shade="muted" render={<label htmlFor="word-diff" />}>
            word diff
          </Text>
        </Group>
      </Group>

      <Group gap={4} fullwidth ay="stretch" evenly>
        <Stack gap={3} ax="stretch">
          <Stack gap={2} ax="stretch">
            <Text size={0} shade="muted">
              old
            </Text>
            <Card ax="stretch">
              <textarea
                value={oldStr}
                onChange={(e) => setOldStr(e.target.value)}
                spellCheck={false}
                style={TEXTAREA_STYLE}
              />
            </Card>
          </Stack>
          <Stack gap={2} ax="stretch">
            <Text size={0} shade="muted">
              new
            </Text>
            <Card ax="stretch">
              <textarea
                value={newStr}
                onChange={(e) => setNewStr(e.target.value)}
                spellCheck={false}
                style={TEXTAREA_STYLE}
              />
            </Card>
          </Stack>
        </Stack>

        <Stack gap={2} ax="stretch">
          <Text size={0} shade="muted">
            diff
          </Text>
          <DiffBlock
            oldStr={oldStr}
            newStr={newStr}
            language={language}
            wordDiff={wordDiff}
          />
        </Stack>
      </Group>
    </Stack>
  );
}

export const Route = createFileRoute("/dev/diff")({
  component: DiffDevPage,
});
