import { Text } from "@uiid/design-system";
import type { CSSProperties, ReactNode } from "react";

export type ChipTone = "green" | "purple";

// Tone -> semantic theme tokens (light-dark aware). GitHub is green
// ("positive"), Linear is purple ("secondary").
const TONES: Record<ChipTone, { surface: string; border: string; fg: string }> =
  {
    green: {
      surface: "var(--theme-positive-surface)",
      border: "var(--theme-positive-border)",
      fg: "var(--theme-positive-foreground)",
    },
    purple: {
      surface: "var(--theme-secondary-surface)",
      border: "var(--theme-secondary-border)",
      fg: "var(--theme-secondary-foreground)",
    },
  };

/**
 * Inline entity pill shared by the GitHub and Linear URL chips. The tone sets
 * surface/border/foreground; the icon inherits `currentColor` and the label
 * is forced to inherit, so both track the tone's foreground in either theme.
 */
export function LinkChip({
  href,
  icon,
  label,
  tone,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  tone: ChipTone;
}) {
  const t = TONES[tone];
  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    maxWidth: "min(44ch, 100%)",
    padding: "1px 6px 1px 5px",
    border: `1px solid ${t.border}`,
    borderRadius: "var(--globals-border-radius)",
    background: t.surface,
    color: t.fg,
    textDecoration: "none",
    verticalAlign: "baseline",
    lineHeight: 1,
  };
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={style}>
      {icon}
      <Text
        size={-1}
        family="mono"
        style={{
          color: "inherit",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </Text>
    </a>
  );
}
