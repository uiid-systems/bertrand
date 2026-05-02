import { Stack } from "@uiid/design-system";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { defaultComponents } from "./components";

type MarkdownProps = {
  children: string;
  components?: Partial<Components>;
};

export function Markdown({ children, components }: MarkdownProps) {
  return (
    <Stack gap={2}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ ...defaultComponents, ...components }}
      >
        {children}
      </ReactMarkdown>
    </Stack>
  );
}
