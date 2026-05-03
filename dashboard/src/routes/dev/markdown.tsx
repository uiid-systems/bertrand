import { Card, Group, Stack, Text } from "@uiid/design-system";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { Markdown } from "../../components/markdown";

const FIXTURE = `# Heading 1 — anchored

## Heading 2 — anchored

### Heading 3

#### Heading 4

##### Heading 5

###### Heading 6

A paragraph with **bold**, *italic*, ~~strikethrough~~, an [external link](https://example.com), and \`inline code\`. Hover the headings to see the slug \`id\` attributes injected by rehype-slug.

> A blockquote can sit between paragraphs. It should look distinct enough to read as a quotation, not just indented prose.

---

## Lists

- Unordered list item one
- Unordered list item two with **emphasis** and \`code\`
  - Nested item
  - Another nested item
    - Three levels deep

1. Ordered list item one
2. Ordered list item two
3. Ordered list item three

### Task list

- [x] Done item
- [x] Another done item
- [ ] Open item
- [ ] Open item with [a link](https://example.com)

---

## Tables

| Feature | Status | Notes |
|---|---|---|
| Headings | ✓ | rehype-slug |
| Tables | ✓ | mapped to TableRoot/Header/Body/Row/Head/Cell |
| Code blocks | ✓ | shiki via CodeBlock |
| Task lists | ✓ | disabled checkbox render |

| Left | Center | Right |
|:---|:---:|---:|
| 1 | 2 | 3 |
| left-aligned | center-aligned | right-aligned |

---

## Code

Inline: use \`bun run typecheck\` or \`tsc --noEmit\` to validate.

\`\`\`ts
// known language — should syntax-highlight
import { Markdown } from "../components/markdown";

export function Demo() {
  return <Markdown>{"# hi"}</Markdown>;
}
\`\`\`

\`\`\`tsx
const App = () => <div>{"jsx works too"}</div>;
\`\`\`

\`\`\`js
// alias — js → javascript
function add(a, b) { return a + b; }
\`\`\`

\`\`\`sh
# alias — sh → bash
bun run dev
\`\`\`

\`\`\`json
{
  "language": "json",
  "ok": true
}
\`\`\`

\`\`\`unknownlanguage
// unknown language — should render plaintext, not throw
some content here
\`\`\`

\`\`\`
no language tag — also plaintext
multiple lines
\`\`\`

---

## Edge cases

A paragraph immediately followed by a fenced block:
\`\`\`ts
const ok = true;
\`\`\`

Paragraph after the fence — should render with normal spacing.

A line with **bold at the very end**

A line ending with \`inline code\`

An empty heading below this line:

##

End of fixture.
`;

function MarkdownDevPage() {
  const [source, setSource] = useState(FIXTURE);

  return (
    <Stack gap={4} p={6} fullwidth style={{ overflow: "auto" }}>
      <Stack gap={2}>
        <Text size={3} weight="bold">
          Markdown kitchen sink
        </Text>
        <Text size={2} shade="muted">
          Edit the source on the left, see it rendered on the right. Reset by
          reloading the page.
        </Text>
      </Stack>

      <Group gap={4} fullwidth ay="stretch" evenly>
        <Stack gap={2} ax="stretch">
          <Text size={0} shade="muted">
            source
          </Text>
          <textarea
            value={source}
            onChange={(e) => setSource(e.target.value)}
            spellCheck={false}
            style={{
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              fontSize: 12,
              lineHeight: 1.5,
              padding: 12,
              minHeight: 600,
              border: "1px solid var(--color-border)",
              borderRadius: 4,
              background: "var(--color-surface)",
              color: "var(--color-text)",
              resize: "vertical",
            }}
          />
        </Stack>

        <Stack gap={2}>
          <Text size={0} shade="muted">
            rendered
          </Text>
          <Card>
            <Markdown>{source}</Markdown>
          </Card>
        </Stack>
      </Group>
    </Stack>
  );
}

export const Route = createFileRoute("/dev/markdown")({
  component: MarkdownDevPage,
});
