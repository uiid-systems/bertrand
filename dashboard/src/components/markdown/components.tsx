import {
  CodeBlock,
  CodeInline,
  LANGUAGE_DISPLAY_NAMES,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRoot,
  TableRow,
  Text,
} from "@uiid/design-system";
import type { BundledLanguage } from "@uiid/design-system";
import type { Components } from "react-markdown";

const BUNDLED_LANGUAGES = new Set(Object.keys(LANGUAGE_DISPLAY_NAMES));

const LANGUAGE_ALIASES: Record<string, BundledLanguage> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  sh: "bash",
  shell: "bash",
  md: "markdown",
};

function resolveLanguage(className: string | undefined): BundledLanguage | undefined {
  const match = /language-([\w-]+)/.exec(className ?? "");
  if (!match) return undefined;
  const raw = match[1]!.toLowerCase();
  if (LANGUAGE_ALIASES[raw]) return LANGUAGE_ALIASES[raw];
  if (BUNDLED_LANGUAGES.has(raw)) return raw as BundledLanguage;
  return undefined;
}

export const defaultComponents: Components = {
  p: ({ children }) => (
    <Text size={1} render={<p />}>
      {children}
    </Text>
  ),
  h1: ({ children, id }) => (
    <Text weight="bold" size={2} render={<h1 id={id} />}>
      {children}
    </Text>
  ),
  h2: ({ children, id }) => (
    <Text weight="bold" size={2} render={<h2 id={id} />}>
      {children}
    </Text>
  ),
  h3: ({ children, id }) => (
    <Text weight="bold" size={1} render={<h3 id={id} />}>
      {children}
    </Text>
  ),
  h4: ({ children, id }) => (
    <Text weight="bold" size={1} render={<h4 id={id} />}>
      {children}
    </Text>
  ),
  h5: ({ children, id }) => (
    <Text weight="bold" render={<h5 id={id} />}>
      {children}
    </Text>
  ),
  h6: ({ children, id }) => (
    <Text weight="bold" render={<h6 id={id} />}>
      {children}
    </Text>
  ),
  strong: ({ children }) => <Text weight="bold">{children}</Text>,
  em: ({ children }) => <em>{children}</em>,
  del: ({ children }) => <del>{children}</del>,
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
  // GFM task-list checkbox — disabled, render-only.
  input: ({ type, checked, disabled }) =>
    type === "checkbox" ? (
      <input type="checkbox" checked={!!checked} disabled={disabled ?? true} readOnly />
    ) : null,
  blockquote: ({ children }) => <blockquote>{children}</blockquote>,
  hr: () => <hr />,
  table: ({ children }) => (
    <TableContainer>
      <TableRoot>{children}</TableRoot>
    </TableContainer>
  ),
  thead: ({ children }) => <TableHeader>{children}</TableHeader>,
  tbody: ({ children }) => <TableBody>{children}</TableBody>,
  tr: ({ children }) => <TableRow>{children}</TableRow>,
  th: ({ children }) => <TableHead>{children}</TableHead>,
  td: ({ children }) => <TableCell>{children}</TableCell>,
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children, ...props }) => {
    const text = String(children ?? "");
    if (!text.includes("\n")) {
      return <CodeInline {...props}>{children}</CodeInline>;
    }
    return (
      <CodeBlock
        code={text.replace(/\n$/, "")}
        language={resolveLanguage(className)}
        copyable
      />
    );
  },
};
