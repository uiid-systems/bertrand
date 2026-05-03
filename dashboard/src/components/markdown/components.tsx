import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import {
  Checkbox,
  CodeBlock,
  CodeInline,
  Group,
  LANGUAGE_DISPLAY_NAMES,
  List,
  Separator,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRoot,
  TableRow,
  Text,
} from "@uiid/design-system";
import type { BundledLanguage, ListItemProps } from "@uiid/design-system";
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

type LiElement = ReactElement<{ children?: ReactNode }>;
type InputElement = ReactElement<{ type?: string; checked?: boolean }>;

function isCheckboxInput(node: ReactNode): node is InputElement {
  return (
    isValidElement(node) &&
    (node as InputElement).props?.type === "checkbox"
  );
}

function isNestedList(node: ReactNode): boolean {
  return isValidElement(node) && (node.type as unknown) === List;
}

function isTaskList(children: ReactNode): boolean {
  return Children.toArray(children).some((c) => {
    if (!isValidElement(c)) return false;
    const liChildren = Children.toArray((c as LiElement).props.children);
    return isCheckboxInput(liChildren[0]);
  });
}

function buildListItems(children: ReactNode): ListItemProps[] {
  return Children.toArray(children)
    .filter((c): c is LiElement => isValidElement(c))
    .map((li, i): ListItemProps => {
      const liChildren = Children.toArray(li.props.children);
      const first = liChildren[0];

      // GFM task-list: li starts with `<input type="checkbox">`. Pair the
      // design-system Checkbox with the remaining rich content (links, code,
      // etc.) — Checkbox's own `label` prop is typed `string` and would drop
      // any inline formatting.
      if (isCheckboxInput(first)) {
        const checked = !!first.props.checked;
        const rest = liChildren.slice(1);
        return {
          value: `item-${i}`,
          label: (
            <Group ay="center" gap={2}>
              <Checkbox checked={checked} disabled />
              <Text>{rest}</Text>
            </Group>
          ),
        };
      }

      // Nested ul/ol: split parent text from the nested List so the inner
      // list renders in ListItem's `content` slot (under the label) instead
      // of inline within it.
      const nestedIndex = liChildren.findIndex(isNestedList);
      if (nestedIndex >= 0) {
        const before = liChildren.slice(0, nestedIndex);
        const nested = liChildren[nestedIndex];
        const after = liChildren.slice(nestedIndex + 1);
        return {
          value: `item-${i}`,
          label: <>{before}</>,
          content: (
            <>
              {nested}
              {after}
            </>
          ),
        };
      }

      return {
        value: `item-${i}`,
        label: <>{liChildren}</>,
      };
    });
}

export const defaultComponents: Components = {
  p: ({ children }) => (
    <Text size={1} render={<p />}>
      {children}
    </Text>
  ),
  h1: ({ children, id }) => (
    <Text weight="bold" size={4} render={<h1 id={id} />}>
      {children}
    </Text>
  ),
  h2: ({ children, id }) => (
    <Text weight="bold" size={3} render={<h2 id={id} />}>
      {children}
    </Text>
  ),
  h3: ({ children, id }) => (
    <Text weight="bold" size={2} render={<h3 id={id} />}>
      {children}
    </Text>
  ),
  h4: ({ children, id }) => (
    <Text weight="bold" size={1} render={<h4 id={id} />}>
      {children}
    </Text>
  ),
  h5: ({ children, id }) => (
    <Text weight="bold" size={0} render={<h5 id={id} />}>
      {children}
    </Text>
  ),
  h6: ({ children, id }) => (
    <Text weight="bold" size={-1} render={<h6 id={id} />}>
      {children}
    </Text>
  ),
  strong: ({ children }) => <Text weight="bold">{children}</Text>,
  em: ({ children }) => <Text render={<em />}>{children}</Text>,
  del: ({ children }) => (
    <Text strikethrough render={<del />}>
      {children}
    </Text>
  ),
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <List
      type={isTaskList(children) ? "none" : "unordered"}
      size="large"
      items={buildListItems(children)}
    />
  ),
  ol: ({ children }) => (
    <List type="ordered" size="large" items={buildListItems(children)} />
  ),
  blockquote: ({ children }) => <blockquote>{children}</blockquote>,
  hr: () => <Separator />,
  table: ({ children }) => (
    <TableContainer>
      <TableRoot bordered>{children}</TableRoot>
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
        style={{ width: "100%" }}
      />
    );
  },
};
