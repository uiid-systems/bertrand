import { CodeBlock, CodeInline, Text } from "@uiid/design-system";
import type { BundledLanguage } from "@uiid/design-system";
import type { Components } from "react-markdown";

export const defaultComponents: Components = {
  p: ({ children }) => (
    <Text size={1} render={<p />}>
      {children}
    </Text>
  ),
  h1: ({ children }) => (
    <Text weight="bold" size={2} render={<h1 />}>
      {children}
    </Text>
  ),
  h2: ({ children }) => (
    <Text weight="bold" size={2} render={<h2 />}>
      {children}
    </Text>
  ),
  h3: ({ children }) => (
    <Text weight="bold" size={1} render={<h3 />}>
      {children}
    </Text>
  ),
  h4: ({ children }) => (
    <Text weight="bold" size={1} render={<h4 />}>
      {children}
    </Text>
  ),
  h5: ({ children }) => (
    <Text weight="bold" render={<h5 />}>
      {children}
    </Text>
  ),
  h6: ({ children }) => (
    <Text weight="bold" render={<h6 />}>
      {children}
    </Text>
  ),
  strong: ({ children }) => <Text weight="bold">{children}</Text>,
  em: ({ children }) => <em>{children}</em>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  ul: ({ children }) => <ul>{children}</ul>,
  ol: ({ children }) => <ol>{children}</ol>,
  li: ({ children }) => (
    <li>
      <Text size={1}>{children}</Text>
    </li>
  ),
  blockquote: ({ children }) => <blockquote>{children}</blockquote>,
  hr: () => <hr />,
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children, ...props }) => {
    const text = String(children ?? "");
    if (!text.includes("\n")) {
      return <CodeInline {...props}>{children}</CodeInline>;
    }
    const langMatch = /language-(\w+)/.exec(className ?? "");
    return (
      <CodeBlock
        code={text.replace(/\n$/, "")}
        language={langMatch?.[1] as BundledLanguage | undefined}
        copyable
      />
    );
  },
};
