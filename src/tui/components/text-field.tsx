import { useEffect, useRef, useState } from "react";
import { Box, Text, useInput, useInterval } from "@orchetron/storm";

export interface TextFieldProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  isFocused?: boolean;
  placeholder?: string;
  placeholderColor?: string;
  color?: string;
  /** Dim suffix rendered inline after the caret. */
  ghost?: string;
  /** Whether the caret blinks while focused. */
  blink?: boolean;
}

/**
 * Single-line input that owns its rendering and input handling end-to-end.
 *
 * We deliberately don't use Storm's TextInput or useTextInputBehavior:
 *   - TextInput's host element forces both an INVERSE caret *and* the
 *     terminal hardware cursor at the same cell — always doubled, no opt-out.
 *   - useTextInputBehavior commits cursor-only changes via Storm's repaint
 *     (no React re-render), so left/right movement never re-evaluates our
 *     JSX and the caret feels laggy.
 *
 * Owning value+cursor as React state keeps the caret responsive and the
 * caret is a single Text-level INVERSE cell, so there's only one cursor
 * on screen.
 */
export function TextField({
  value,
  onChange,
  onSubmit,
  isFocused = true,
  placeholder,
  placeholderColor = "gray",
  color,
  ghost,
  blink = true,
}: TextFieldProps) {
  const [cursor, setCursor] = useState(value.length);

  // When the parent replaces `value` (e.g. ghost-text accept rewrites the
  // filter), jump the caret to the end. Our own edits set this ref before
  // calling onChange, so we don't trip this on every keystroke.
  const lastWrittenRef = useRef(value);
  useEffect(() => {
    if (lastWrittenRef.current !== value) {
      lastWrittenRef.current = value;
      setCursor(value.length);
    }
  }, [value]);

  const [caretOn, setCaretOn] = useState(true);
  useInterval(() => setCaretOn((c) => !c), 500, {
    active: isFocused && blink,
  });
  // Keep the caret visible while actively typing or moving.
  useEffect(() => {
    setCaretOn(true);
  }, [value, cursor]);

  const apply = (newValue: string, newCursor: number) => {
    lastWrittenRef.current = newValue;
    onChange(newValue);
    setCursor(newCursor);
  };

  useInput(
    (e) => {
      if (!isFocused) return;
      if (e.consumed) return;

      // Let the picker handle these (list nav / meta keys / ghost accept).
      if (
        e.key === "tab" ||
        e.key === "escape" ||
        e.key === "up" ||
        e.key === "down"
      ) {
        return;
      }

      if (e.key === "return") {
        onSubmit?.(value);
        e.consumed = true;
        return;
      }
      if (e.key === "backspace") {
        if (cursor > 0) {
          apply(value.slice(0, cursor - 1) + value.slice(cursor), cursor - 1);
        }
        e.consumed = true;
        return;
      }
      if (e.key === "delete") {
        if (cursor < value.length) {
          apply(value.slice(0, cursor) + value.slice(cursor + 1), cursor);
        }
        e.consumed = true;
        return;
      }
      if (e.key === "left") {
        if (cursor > 0) {
          setCursor(cursor - 1);
          e.consumed = true;
        }
        return;
      }
      if (e.key === "right") {
        if (cursor < value.length) {
          setCursor(cursor + 1);
          e.consumed = true;
        }
        return;
      }
      if (e.key === "home") {
        setCursor(0);
        e.consumed = true;
        return;
      }
      if (e.key === "end") {
        setCursor(value.length);
        e.consumed = true;
        return;
      }
      if (e.char && !e.ctrl && !e.meta) {
        apply(
          value.slice(0, cursor) + e.char + value.slice(cursor),
          cursor + e.char.length,
        );
        e.consumed = true;
      }
    },
    { isActive: isFocused, priority: 1 },
  );

  const showCaret = isFocused && (!blink || caretOn);

  if (value.length === 0) {
    return (
      <Box flexDirection="row">
        <Text inverse={showCaret} color={color}>
          {" "}
        </Text>
        {placeholder && (
          <Text color={placeholderColor} dim>
            {placeholder}
          </Text>
        )}
        {ghost && <Text dim>{ghost}</Text>}
      </Box>
    );
  }

  const before = value.slice(0, cursor);
  const atCursor = value.slice(cursor, cursor + 1) || " ";
  const after = value.slice(cursor + 1);

  return (
    <Box flexDirection="row">
      {before && <Text color={color}>{before}</Text>}
      <Text inverse={showCaret} color={color}>
        {atCursor}
      </Text>
      {after && <Text color={color}>{after}</Text>}
      {ghost && <Text dim>{ghost}</Text>}
    </Box>
  );
}
