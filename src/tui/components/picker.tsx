import { useMemo, useState } from "react";
import {
  Box,
  Text,
  TextInput,
  useGhostText,
  useInput,
} from "@orchetron/storm";
import type { ReactNode } from "react";

type KeyEvent = Parameters<Parameters<typeof useInput>[0]>[0];

export interface PickerItem {
  value: string;
  /** Used for filter matching and as fallback render. */
  label: string;
  color?: string | null;
  meta?: string;
  /** Render this instead of the label string when present. Pass a function to react to cursor state. */
  display?: ReactNode | ((isCursor: boolean) => ReactNode);
  /** Decorative group header — never gets the cursor and is hidden while filtering. */
  kind?: "item" | "header";
  /** Cursor skips this row; rendered dimmed. */
  disabled?: boolean;
  /** Apply dim styling without disabling selection. */
  dim?: boolean;
}

interface BasePickerProps {
  items: PickerItem[];
  isFocused: boolean;
  placeholder?: string;
  allowCreate?: boolean;
  emptyHint?: string;
  maxVisible?: number;
  /** Ghost-text autocomplete source. Accepts with Tab when a suggestion is visible. */
  suggest?: ((value: string) => string | null) | string[];
  /** Receives keys the picker doesn't handle, along with the current cursor row. */
  onKey?: (e: KeyEvent, cursorItem: PickerItem | null) => void;
}

interface SinglePickerProps extends BasePickerProps {
  mode: "single";
  onSubmit: (value: string) => void;
}

interface MultiPickerProps extends BasePickerProps {
  mode: "multi";
  selected: string[];
  onToggle: (value: string) => void;
  onDone: () => void;
}

export type PickerProps = SinglePickerProps | MultiPickerProps;

const NEW_KEY = "__new__";

function isSelectable(row: PickerItem | { value: typeof NEW_KEY }) {
  if (row.value === NEW_KEY) return true;
  const item = row as PickerItem;
  return item.kind !== "header" && !item.disabled;
}

function findNextSelectable(
  rows: Array<PickerItem | { value: typeof NEW_KEY }>,
  from: number,
  direction: 1 | -1,
): number {
  let i = from;
  while (i >= 0 && i < rows.length) {
    if (isSelectable(rows[i]!)) return i;
    i += direction;
  }
  return -1;
}

function findFirstSelectable(
  rows: Array<PickerItem | { value: typeof NEW_KEY }>,
): number {
  return findNextSelectable(rows, 0, 1);
}

function isHeader(
  row: PickerItem | { value: typeof NEW_KEY } | undefined,
): boolean {
  return !!row && row.value !== NEW_KEY && (row as PickerItem).kind === "header";
}

/** First selectable row after the header immediately preceding `cursor`. */
function findCurrentGroupStart(
  rows: Array<PickerItem | { value: typeof NEW_KEY }>,
  cursor: number,
): number {
  for (let i = cursor; i >= 0; i--) {
    if (isHeader(rows[i])) {
      return findNextSelectable(rows, i + 1, 1);
    }
  }
  return findFirstSelectable(rows);
}

/** First selectable row of the next group, or -1 if cursor is in the last. */
function findNextGroupStart(
  rows: Array<PickerItem | { value: typeof NEW_KEY }>,
  cursor: number,
): number {
  for (let i = cursor + 1; i < rows.length; i++) {
    if (isHeader(rows[i])) {
      return findNextSelectable(rows, i + 1, 1);
    }
  }
  return -1;
}

/** First selectable row of the previous group, or -1 if cursor is in the first. */
function findPrevGroupStart(
  rows: Array<PickerItem | { value: typeof NEW_KEY }>,
  cursor: number,
): number {
  let i = cursor;
  for (; i >= 0; i--) {
    if (isHeader(rows[i])) break;
  }
  for (i = i - 1; i >= 0; i--) {
    if (isHeader(rows[i])) {
      return findNextSelectable(rows, i + 1, 1);
    }
  }
  return -1;
}

export function Picker(props: PickerProps) {
  const {
    items,
    isFocused,
    placeholder,
    allowCreate = true,
    emptyHint,
    maxVisible = 12,
  } = props;

  const [filter, setFilter] = useState("");
  const [cursor, setCursor] = useState(0);

  const ghostResult = useGhostText({
    value: filter,
    cursor: filter.length,
    suggest: props.suggest ?? [],
  });
  const ghost = props.suggest ? ghostResult.ghost : "";

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    // Hide headers while filtering — the flat result is easier to scan.
    return items.filter(
      (it) => it.kind !== "header" && it.label.toLowerCase().includes(q),
    );
  }, [filter, items]);

  const exactMatch = useMemo(
    () =>
      filtered.some(
        (it) =>
          it.kind !== "header" &&
          it.label.toLowerCase() === filter.trim().toLowerCase(),
      ),
    [filter, filtered],
  );

  const showCreate = allowCreate && filter.trim().length > 0 && !exactMatch;

  const visibleRows: Array<PickerItem | { value: typeof NEW_KEY }> = useMemo(
    () => (showCreate ? [...filtered, { value: NEW_KEY }] : filtered),
    [filtered, showCreate],
  );

  // Keep cursor on a selectable row whenever the list reshapes.
  if (visibleRows.length === 0) {
    if (cursor !== 0) setTimeout(() => setCursor(0), 0);
  } else if (
    cursor >= visibleRows.length ||
    !isSelectable(visibleRows[cursor]!)
  ) {
    const next = findFirstSelectable(visibleRows);
    if (next !== -1 && next !== cursor) {
      setTimeout(() => setCursor(next), 0);
    }
  }

  useInput(
    (e) => {
      if (!isFocused) return;
      if (e.key === "escape" && filter.length > 0) {
        setFilter("");
        setCursor(0);
        return;
      }
      if (visibleRows.length === 0) return;
      if (e.key === "up") {
        setCursor((c) => {
          const next = findNextSelectable(visibleRows, c - 1, -1);
          return next === -1 ? c : next;
        });
      } else if (e.key === "down") {
        setCursor((c) => {
          const next = findNextSelectable(visibleRows, c + 1, 1);
          return next === -1 ? c : next;
        });
      } else if (e.key === "tab" && ghost) {
        const full = ghostResult.accept();
        if (full !== null) setFilter(full);
      } else if (filter.length === 0 && e.key === "left") {
        setCursor((c) => {
          const curr = findCurrentGroupStart(visibleRows, c);
          if (curr !== -1 && curr !== c) return curr;
          const prev = findPrevGroupStart(visibleRows, c);
          return prev === -1 ? c : prev;
        });
      } else if (filter.length === 0 && e.key === "right") {
        setCursor((c) => {
          const next = findNextGroupStart(visibleRows, c);
          return next === -1 ? c : next;
        });
      } else if (e.key === "tab" && props.mode === "multi") {
        props.onDone();
      } else if (props.onKey) {
        const row = visibleRows[cursor];
        const cursorItem =
          row && row.value !== NEW_KEY ? (row as PickerItem) : null;
        props.onKey(e, cursorItem);
      }
    },
    { isActive: isFocused },
  );

  const submitCursor = () => {
    const row = visibleRows[cursor];
    if (!row || !isSelectable(row)) return;
    const value =
      row.value === NEW_KEY ? filter.trim() : (row as PickerItem).value;
    if (!value) return;

    if (props.mode === "single") {
      props.onSubmit(value);
      setFilter("");
      setCursor(0);
    } else {
      props.onToggle(value);
      setFilter("");
      setCursor(0);
    }
  };

  const handleSubmit = (text: string) => {
    if (visibleRows.length === 0) {
      if (allowCreate && text.trim() && props.mode === "single") {
        props.onSubmit(text.trim());
        setFilter("");
      }
      return;
    }
    submitCursor();
  };

  const visibleStart = Math.max(
    0,
    Math.min(
      cursor - Math.floor(maxVisible / 2),
      visibleRows.length - maxVisible,
    ),
  );
  const visibleEnd = Math.min(visibleRows.length, visibleStart + maxVisible);
  const slice = visibleRows.slice(visibleStart, visibleEnd);

  const selectedSet =
    props.mode === "multi" ? new Set(props.selected) : new Set<string>();

  return (
    <Box flexDirection="column" gap={0} width="100%">
      {props.mode === "multi" && props.selected.length > 0 && (
        <Box flexDirection="row" gap={1}>
          <Text dim>Selected:</Text>
          {props.selected.map((v) => {
            const item = items.find((i) => i.value === v);
            return (
              <Text key={v} color={item?.color ?? "cyan"}>
                {item?.label ?? v}
              </Text>
            );
          })}
        </Box>
      )}

      <Box
        borderStyle="round"
        borderColor={isFocused ? "green" : undefined}
        borderDimColor={!isFocused}
        paddingX={1}
      >
        <TextInput
          value={filter}
          onChange={setFilter}
          onSubmit={handleSubmit}
          placeholder={placeholder}
          color="green"
          placeholderColor="gray"
          isFocused={isFocused}
        />
      </Box>
      {ghost && (
        <Box paddingX={1}>
          <Text dim>↪ {filter}</Text>
          <Text color="cyan">{ghost}</Text>
          <Text dim> · tab to accept</Text>
        </Box>
      )}

      <Box
        flexDirection="column"
        borderStyle="round"
        borderDimColor
        paddingX={1}
      >
        {visibleStart > 0 && <Text dim>▲ {visibleStart} more above</Text>}
        {slice.length === 0 && emptyHint && <Text dim>{emptyHint}</Text>}
        {slice.map((row, i) => {
          const idx = visibleStart + i;
          const isCursor = idx === cursor && isFocused;
          const isNew = row.value === NEW_KEY;
          const showDivider = isNew && filtered.length > 0 && i > 0;

          if (isNew) {
            return (
              <Box key="__new__" flexDirection="column">
                {showDivider && (
                  <Text dim>
                    {"─".repeat(Math.min(20, filter.length + 12))}
                  </Text>
                )}
                <Box flexDirection="row" gap={1}>
                  <Text color={isCursor ? "green" : "cyan"} bold>
                    {isCursor ? "❯ " : "  "}✚ create “{filter.trim()}”
                  </Text>
                </Box>
              </Box>
            );
          }

          const item = row as PickerItem;

          if (item.kind === "header") {
            return (
              <Box key={`h:${item.value}`} flexDirection="row">
                <Text dim bold color={item.color ?? undefined}>
                  {item.label}
                </Text>
              </Box>
            );
          }

          const isSelected = selectedSet.has(item.value);
          const marker =
            props.mode === "multi" ? (isSelected ? "✓ " : "  ") : "";
          const dim = item.dim || item.disabled;

          return (
            <Box
              key={item.value}
              flexDirection="row"
              justifyContent="space-between"
              gap={1}
            >
              <Box flexDirection="row" gap={0}>
                {item.display ? (
                  typeof item.display === "function" ? (
                    item.display(isCursor)
                  ) : (
                    item.display
                  )
                ) : (
                  <Text
                    color={isCursor ? "green" : (item.color ?? undefined)}
                    bold={isCursor}
                    dim={!isCursor && dim}
                  >
                    {isCursor ? "❯ " : "  "}
                    {marker}
                    {item.label}
                  </Text>
                )}
              </Box>
              {item.meta && (
                <Text
                  color={isCursor ? "green" : undefined}
                  bold={isCursor}
                  dim={!isCursor}
                >
                  {item.meta}
                </Text>
              )}
            </Box>
          );
        })}
        {visibleEnd < visibleRows.length && (
          <Text dim>▼ {visibleRows.length - visibleEnd} more below</Text>
        )}
      </Box>
    </Box>
  );
}
