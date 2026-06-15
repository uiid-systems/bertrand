import { useEffect, useState } from "react";
import { CodeBlock, getHighlighter, loadLanguage } from "@uiid/design-system";
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
  /** Visible rows before CodeBlock collapses behind a "Show more" toggle. */
  rows?: number;
  /** Initial expanded state when `rows` is set. */
  defaultExpanded?: boolean;
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

// Strip the common leading whitespace from both inputs so a snippet pulled
// from deep inside a file doesn't render with a giant gap after the +/-
// marker. Considers all non-blank lines across old and new together so the
// two stay aligned.
function dedent(oldStr: string, newStr: string): [string, string] {
  const lines = [...oldStr.split("\n"), ...newStr.split("\n")];
  let min = Infinity;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const m = line.match(/^[ \t]*/);
    const n = m ? m[0].length : 0;
    if (n < min) min = n;
  }
  if (min === Infinity || min === 0) return [oldStr, newStr];
  const strip = (s: string) =>
    s
      .split("\n")
      .map((l) => (l.length >= min ? l.slice(min) : l))
      .join("\n");
  return [strip(oldStr), strip(newStr)];
}

function computeDiff(
  oldStr: string,
  newStr: string,
  wordDiff: boolean,
): DiffComputed {
  const [dOld, dNew] = dedent(oldStr, newStr);
  const changes = diffLines(dOld, dNew);
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

      const pairs = wordDiff
        ? Math.min(removed.lns.length, added.lns.length)
        : 0;
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
  rows,
  defaultExpanded,
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
              // Use nbsp on context lines so the empty marker span still
              // generates an inline box (gives it height + width so its
              // border renders).
              const markerText =
                kind === "add" ? "+" : kind === "remove" ? "-" : " ";
              // GitHub-style two-column gutter: old# on the left, new# on the
              // right. Add lines blank the old col, remove lines blank the new
              // col, context shows both. Blank cells get .diff-num-blank so
              // CSS can render them with the neutral gutter bg, not the line
              // tint.
              const oldCls =
                "diff-num diff-num-old" +
                (nums.old == null ? " diff-num-blank" : "");
              const newCls =
                "diff-num diff-num-new" +
                (nums.new == null ? " diff-num-blank" : "");
              // Empty number cells get nbsp (same trick as the empty marker)
              // so the inline-block renders with its background.
              const prepend = [
                gutterSpan(oldCls, nums.old != null ? String(nums.old) : " "),
                gutterSpan(newCls, nums.new != null ? String(nums.new) : " "),
                gutterSpan(markerCls, markerText),
              ];
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
          "--diff-num-width": `${numWidth + 2}ch`,
          width: "100%",
        } as React.CSSProperties
      }
    >
      <CodeBlock
        code={newStr}
        language={language}
        filename={filename}
        showLineNumbers={false}
        rows={rows}
        defaultExpanded={defaultExpanded}
        HeaderProps={{ copyable: false }}
        html={html}
        style={{ width: "100%" }}
      />
    </div>
  );
}
DiffBlock.displayName = "DiffBlock";
