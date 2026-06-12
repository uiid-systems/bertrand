import { useEffect, useState } from "react";
import { Box, Text, useInterval } from "@orchetron/storm";
import { useTextInputBehavior } from "@orchetron/storm/headless";

export interface TextFieldProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  isFocused?: boolean;
  placeholder?: string;
  placeholderColor?: string;
  color?: string;
  /** Dim suffix rendered after the caret (for autocomplete previews). */
  ghost?: string;
  /** Whether the caret blinks while focused. */
  blink?: boolean;
}

/**
 * Custom single-line input that renders its own caret as a Text-level INVERSE
 * cell. Bypasses Storm's tui-text-input host, so the terminal hardware cursor
 * stays hidden and we own the only caret on screen.
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
  const behavior = useTextInputBehavior({
    value,
    onChange,
    onSubmit,
    isFocused,
  });

  const [caretOn, setCaretOn] = useState(true);
  useInterval(() => setCaretOn((c) => !c), 500, {
    active: isFocused && blink,
  });
  // Keep the caret visible whenever the value changes — feels broken otherwise.
  useEffect(() => {
    setCaretOn(true);
  }, [value, behavior.cursorPosition]);

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

  const cursor = behavior.cursorPosition;
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
