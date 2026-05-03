import { Stack } from "@uiid/design-system";
import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";

import { defaultComponents } from "./components";

type MarkdownProps = {
  children: string;
  components?: Partial<Components>;
};

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeSlug];

function MarkdownImpl({ children, components }: MarkdownProps) {
  return (
    <Stack gap={4} fullwidth>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={{ ...defaultComponents, ...components }}
      >
        {children}
      </ReactMarkdown>
    </Stack>
  );
}

export const Markdown = memo(MarkdownImpl);
