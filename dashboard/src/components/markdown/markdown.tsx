import { Stack } from "@uiid/design-system";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { defaultComponents } from "./components";

type MarkdownProps = {
  children: string;
  components?: Partial<Components>;
};

// AskUserQuestion captures user-typed notes with `\r` line breaks and tends to
// flatten pasted content — leaving fenced code markers (```) mid-line, which
// remark-gfm refuses to parse as code blocks. Force every ``` onto its own
// line so multi-line pastes still render as code.
function normalizeMarkdown(input: string): string {
  let out = input.replace(/\r\n?/g, "\n");
  out = out.replace(/([^\n])```/g, "$1\n```");
  out = out.replace(/```([^\n])/g, "```\n$1");
  return out;
}

export function Markdown({ children, components }: MarkdownProps) {
  return (
    <Stack gap={4} fullwidth>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ ...defaultComponents, ...components }}
      >
        {normalizeMarkdown(children)}
      </ReactMarkdown>
    </Stack>
  );
}
