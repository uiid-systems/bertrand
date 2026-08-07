import { paletteColorStyles, Text, type PaletteColor } from "@uiid/design-system";
import type { CSSProperties, ReactNode } from "react";

// GitHub is green, Linear is purple. Narrowed from the design system's hues
// rather than restated, so a renamed ramp surfaces here as a type error.
export type ChipTone = Extract<PaletteColor, "green" | "purple">;

/**
 * Inline entity pill shared by the GitHub and Linear URL chips. The tone rides
 * on a `.palette-<hue>` class rather than being named in CSS: the class
 * publishes the `--palette-*` slots this reads, so the chip cannot drift from
 * any other component tinted the same hue. The icon inherits `currentColor`
 * and the label is forced to inherit, so both track the tint's foreground in
 * either theme.
 *
 * The label is split into a bold `lead` (the identifier / type) and an
 * optional normal-weight `rest`, joined by `: ` — e.g. **UI-177**: Title.
 */
export function LinkChip({
  href,
  icon,
  lead,
  rest,
  tone,
}: {
  href: string;
  icon: ReactNode;
  lead: string;
  rest?: string;
  tone: ChipTone;
}) {
  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    maxWidth: "min(44ch, 100%)",
    padding: "1px 6px 1px 5px",
    border: "1px solid var(--palette-tint-border)",
    borderRadius: "var(--globals-border-radius)",
    background: "var(--palette-tint)",
    color: "var(--palette-on-tint)",
    textDecoration: "none",
    verticalAlign: "baseline",
    lineHeight: 1,
  };
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={paletteColorStyles[tone]}
      style={style}
    >
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
        <span style={{ fontWeight: "bold" }}>{lead}</span>
        {rest ? `: ${rest}` : null}
      </Text>
    </a>
  );
}
