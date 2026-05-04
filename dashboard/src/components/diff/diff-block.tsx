import { useEffect, useState } from "react";
import {
  CodeBlock,
  getHighlighter,
  loadLanguage,
} from "@uiid/design-system";
import type { BundledLanguage } from "@uiid/design-system";
import { diffLines, diffWordsWithSpace } from "diff";

import "./diff-block.css";

type DiffBlockProps = {
  oldStr: string;
  newStr: string;
  language?: BundledLanguage;
  filename?: string;
  /** Word-level intra-line diff. Off until we redesign the visual. */
  wordDiff?: boolean;
};

type LineKind = "context" | "add" | "remove";

type Decoration = {
  start: { line: number; character: number };
  end: { line: number; character: number };
  properties: { class: string };
};

type LineNum = { old: number | null; new: number | null };

type DiffComputed = {
  code: string;
  lineKinds: LineKind[];
  lineNums: LineNum[];
  decorations: Decoration[];
  maxLineNum: number;
};

function computeDiff(
  oldStr: string,
  newStr: string,
  wordDiff: boolean,
): DiffComputed {
  const changes = diffLines(oldStr, newStr);
  const codeLines: string[] = [];
  const lineKinds: LineKind[] = [];
  const decorations: Decoration[] = [];

  function pushBlock(
    value: string,
    kind: LineKind,
  ): { startIdx: number; lns: string[] } {
    const startIdx = codeLines.length;
    const trimmed = value.endsWith("\n") ? value.slice(0, -1) : value;
    const lns = trimmed.split("\n");
    for (const line of lns) {
      codeLines.push(line);
      lineKinds.push(kind);
    }
    return { startIdx, lns };
  }

  let i = 0;
  while (i < changes.length) {
    const c = changes[i]!;

    // Adjacent removed→added: pair lines by index, run word-diff on each pair.
    if (c.removed && i + 1 < changes.length && changes[i + 1]!.added) {
      const removed = pushBlock(c.value, "remove");
      const added = pushBlock(changes[i + 1]!.value, "add");

      const pairs = wordDiff ? Math.min(removed.lns.length, added.lns.length) : 0;
      for (let p = 0; p < pairs; p++) {
        const wordChanges = diffWordsWithSpace(removed.lns[p]!, added.lns[p]!);
        let removedCol = 0;
        let addedCol = 0;
        for (const wc of wordChanges) {
          const len = wc.value.length;
          if (wc.added) {
            if (len > 0) {
              decorations.push({
                start: { line: added.startIdx + p, character: addedCol },
                end: { line: added.startIdx + p, character: addedCol + len },
                properties: { class: "diff-word add" },
              });
            }
            addedCol += len;
          } else if (wc.removed) {
            if (len > 0) {
              decorations.push({
                start: { line: removed.startIdx + p, character: removedCol },
                end: {
                  line: removed.startIdx + p,
                  character: removedCol + len,
                },
                properties: { class: "diff-word remove" },
              });
            }
            removedCol += len;
          } else {
            removedCol += len;
            addedCol += len;
          }
        }
      }
      i += 2;
    } else if (c.removed) {
      pushBlock(c.value, "remove");
      i += 1;
    } else if (c.added) {
      pushBlock(c.value, "add");
      i += 1;
    } else {
      pushBlock(c.value, "context");
      i += 1;
    }
  }

  // Old/new line numbers, GitHub-style: removed lines get an old#, added lines
  // get a new#, context lines get both. Both increment in lockstep on context.
  const lineNums: LineNum[] = [];
  let oldCounter = 1;
  let newCounter = 1;
  for (const kind of lineKinds) {
    if (kind === "remove") {
      lineNums.push({ old: oldCounter++, new: null });
    } else if (kind === "add") {
      lineNums.push({ old: null, new: newCounter++ });
    } else {
      lineNums.push({ old: oldCounter++, new: newCounter++ });
    }
  }

  // Final counters reflect total old/new lines (1-based; subtract 1 for max).
  const maxLineNum = Math.max(oldCounter - 1, newCounter - 1, 1);

  return {
    code: codeLines.join("\n"),
    lineKinds,
    lineNums,
    decorations,
    maxLineNum,
  };
}

function addClass(node: { properties?: Record<string, unknown> }, cls: string) {
  if (!node.properties) node.properties = {};
  const existing = node.properties.class;
  if (typeof existing === "string") {
    node.properties.class = existing ? `${existing} ${cls}` : cls;
  } else if (Array.isArray(existing)) {
    node.properties.class = [...existing, cls];
  } else {
    node.properties.class = cls;
  }
}

function gutterSpan(cls: string, value: string) {
  return {
    type: "element" as const,
    tagName: "span",
    properties: { class: cls },
    children: [{ type: "text" as const, value }],
  };
}

export function DiffBlock({
  oldStr,
  newStr,
  language = "tsx",
  filename,
  wordDiff = false,
}: DiffBlockProps) {
  const [html, setHtml] = useState<string>("");
  const [numWidth, setNumWidth] = useState<number>(1);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { code, lineKinds, lineNums, decorations, maxLineNum } =
        computeDiff(oldStr, newStr, wordDiff);

      await loadLanguage(language);
      const hl = await getHighlighter();

      const result = hl.codeToHtml(code, {
        lang: language,
        themes: { light: "vitesse-light", dark: "vitesse-black" },
        defaultColor: false,
        decorations,
        transformers: [
          {
            name: "diff-block:line-marks",
            pre(node) {
              addClass(node, "has-diff");
            },
            line(node, lineNumber) {
              const idx = lineNumber - 1;
              const kind = lineKinds[idx];
              const nums = lineNums[idx]!;
              if (kind === "add" || kind === "remove") {
                addClass(node, `diff ${kind}`);
              }
              const markerCls =
                kind === "add"
                  ? "diff-marker add"
                  : kind === "remove"
                    ? "diff-marker remove"
                    : "diff-marker";
              const markerText =
                kind === "add" ? "+" : kind === "remove" ? "-" : "";
              // Show old# only on removed lines, new# everywhere else.
              // Drops the redundant old# from context lines so the gutter
              // is always a single number column.
              const showOld = kind === "remove";
              const showNew = kind !== "remove";
              const prepend = [
                showOld && nums.old != null
                  ? gutterSpan("diff-num diff-num-old", String(nums.old))
                  : null,
                showNew && nums.new != null
                  ? gutterSpan("diff-num diff-num-new", String(nums.new))
                  : null,
                gutterSpan(markerCls, markerText),
              ].filter((n): n is NonNullable<typeof n> => n != null);
              node.children.unshift(...prepend);
              return node;
            },
          },
        ],
      });

      if (!cancelled) {
        setHtml(result);
        setNumWidth(String(maxLineNum).length);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [oldStr, newStr, language, wordDiff]);

  return (
    <div
      className="bertrand-diff-block"
      style={
        {
          "--diff-num-width": `${numWidth}ch`,
          width: "100%",
        } as React.CSSProperties
      }
    >
      <CodeBlock
        code={newStr}
        language={language}
        filename={filename}
        showLineNumbers={false}
        copyable={false}
        html={html}
        style={{ width: "100%" }}
      />
    </div>
  );
}
DiffBlock.displayName = "DiffBlock";
