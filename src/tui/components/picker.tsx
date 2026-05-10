import { useMemo, useState } from "react";
import { Box, Text, TextInput, useInput } from "@orchetron/storm";

export interface PickerItem {
  value: string;
  label: string;
  color?: string | null;
  meta?: string;
}

interface BasePickerProps {
  items: PickerItem[];
  isFocused: boolean;
  placeholder?: string;
  allowCreate?: boolean;
  emptyHint?: string;
  maxVisible?: number;
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

export function Picker(props: PickerProps) {
  const {
    items,
    isFocused,
    placeholder,
    allowCreate = true,
    emptyHint,
    maxVisible = 8,
  } = props;

  const [filter, setFilter] = useState("");
  const [cursor, setCursor] = useState(0);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => it.label.toLowerCase().includes(q));
  }, [filter, items]);

  const exactMatch = useMemo(
    () =>
      filtered.some(
        (it) => it.label.toLowerCase() === filter.trim().toLowerCase(),
      ),
    [filter, filtered],
  );

  const showCreate =
    allowCreate && filter.trim().length > 0 && !exactMatch;

  const visibleRows: Array<PickerItem | { value: typeof NEW_KEY }> = useMemo(
    () => (showCreate ? [...filtered, { value: NEW_KEY }] : filtered),
    [filtered, showCreate],
  );

  // Clamp cursor when list shrinks
  if (cursor >= visibleRows.length) {
    setTimeout(() => setCursor(Math.max(0, visibleRows.length - 1)), 0);
  }

  // No priority — runs alongside TextInput. TextInput ignores up/down/tab/esc,
  // so there's no conflict.
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
        setCursor((c) => Math.max(0, c - 1));
      } else if (e.key === "down") {
        setCursor((c) => Math.min(visibleRows.length - 1, c + 1));
      } else if (e.key === "tab" && props.mode === "multi") {
        props.onDone();
      }
    },
    { isActive: isFocused },
  );

  const submitCursor = () => {
    const row = visibleRows[cursor];
    const value =
      row && row.value === NEW_KEY ? filter.trim() : (row?.value ?? "");
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
    Math.min(cursor - Math.floor(maxVisible / 2), visibleRows.length - maxVisible),
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
          // Visual divider above "+ new" when there are real items above it.
          const showDivider =
            isNew && filtered.length > 0 && i > 0;

          if (isNew) {
            return (
              <Box key="__new__" flexDirection="column">
                {showDivider && (
                  <Text dim>{"─".repeat(Math.min(20, filter.length + 12))}</Text>
                )}
                <Box
                  flexDirection="row"
                  gap={1}
                  backgroundColor={isCursor ? "green" : undefined}
                >
                  <Text color={isCursor ? "black" : "cyan"} bold>
                    ✚ create “{filter.trim()}”
                  </Text>
                </Box>
              </Box>
            );
          }

          const item = row as PickerItem;
          const isSelected = selectedSet.has(item.value);
          const marker =
            props.mode === "multi" ? (isSelected ? "✓ " : "  ") : "";

          return (
            <Box
              key={item.value}
              flexDirection="row"
              justifyContent="space-between"
              gap={1}
              backgroundColor={isCursor ? "green" : undefined}
            >
              <Text
                color={isCursor ? "black" : (item.color ?? undefined)}
                bold={isCursor}
              >
                {marker}
                {item.label}
              </Text>
              {item.meta && (
                <Box
                  paddingX={1}
                  backgroundColor={isCursor ? "black" : "#3a3a3a"}
                >
                  <Text color={isCursor ? "green" : "white"} bold>
                    {item.meta}
                  </Text>
                </Box>
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
