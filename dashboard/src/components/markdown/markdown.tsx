import { Stack } from "@uiid/design-system";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { defaultComponents } from "./components";

type MarkdownProps = {
  children: string;
  components?: Partial<Components>;
};

// AskUserQuestion stores user-typed notes with `\r` line breaks, which
// react-markdown ignores — collapsing fenced code blocks and lists onto one line.
function normalizeLineEndings(input: string): string {
  return input.replace(/\r\n?/g, "\n");
}

export function Markdown({ children, components }: MarkdownProps) {
  return (
    <Stack gap={2}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ ...defaultComponents, ...components }}
      >
        {normalizeLineEndings(children)}
      </ReactMarkdown>
    </Stack>
  );
}
