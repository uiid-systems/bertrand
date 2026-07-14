import { SiLinear } from "@icons-pack/react-simple-icons";

import { linearChipParts, parseLinearUrl } from "./linear-url";
import { LinkChip } from "./link-chip";

/**
 * Renders a bare Linear URL as a compact purple entity chip (Linear mark +
 * `UI-177 · Title` for issues, or the project name). Falls back to a plain
 * link when the URL isn't a recognizable Linear entity. No network — the
 * label comes from the URL.
 */
export function LinearLinkChip({ href }: { href: string }) {
  const ref = parseLinearUrl(href);

  if (!ref) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {href}
      </a>
    );
  }

  const { lead, rest } = linearChipParts(ref);
  return (
    <LinkChip
      href={href}
      icon={<SiLinear size={12} />}
      lead={lead}
      rest={rest}
      tone="purple"
    />
  );
}
