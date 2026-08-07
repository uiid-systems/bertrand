import { useState } from "react";
import { Button, Group, Text } from "@uiid/design-system";
import { StarIcon } from "@uiid/icons";

const STARS = [1, 2, 3, 4, 5] as const;

/**
 * The 1-5 effectiveness rating from the TUI exit screen, as a pointer control.
 *
 * There is no rating primitive in the design system, so this recombines
 * `Button` + `StarIcon` rather than inventing chrome. Hover previews the value
 * the way the keyboard version previews nothing — the TUI has number keys, and
 * a mouse needs the equivalent affordance.
 *
 * Clicking the current rating clears it, which is the pointer equivalent of the
 * exit screen's 0/backspace. Without it a misclick would be unfixable: there is
 * no "zero stars" target to aim at.
 */
export function StarRating({
  value,
  onChange,
  disabled,
}: {
  readonly value: number | null;
  readonly onChange: (next: number | null) => void;
  readonly disabled?: boolean;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const shown = hovered ?? value;

  return (
    <Group gap={2} ay="center">
      <Group gap={0} ay="center" onMouseLeave={() => setHovered(null)}>
        {STARS.map((n) => {
          const filled = shown !== null && n <= shown;
          return (
            <Button
              key={n}
              size="xsmall"
              variant="ghost"
              shape="square"
              disabled={disabled}
              onMouseEnter={() => setHovered(n)}
              onFocus={() => setHovered(n)}
              onBlur={() => setHovered(null)}
              onClick={() => onChange(value === n ? null : n)}
              aria-label={
                value === n ? `Clear rating` : `Rate ${n} star${n === 1 ? "" : "s"}`
              }
              aria-pressed={value !== null && n <= value}
            >
              <StarIcon
                size={13}
                fill={filled ? "currentColor" : "none"}
                style={{ opacity: filled ? 1 : 0.45 }}
              />
            </Button>
          );
        })}
      </Group>
      <Text size={-1} shade="muted">
        {value !== null ? `${value} of 5` : "unrated"}
      </Text>
    </Group>
  );
}
StarRating.displayName = "StarRating";
