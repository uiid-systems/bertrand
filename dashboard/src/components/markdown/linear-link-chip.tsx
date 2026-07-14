import { LayersIcon, TicketIcon } from "@uiid/icons";

import { linearRefLabel, parseLinearUrl, type LinearRef } from "./linear-url";
import { LinkChip } from "./link-chip";

function iconFor(ref: LinearRef) {
  switch (ref.kind) {
    case "project":
      return <LayersIcon size={12} />;
    default:
      return <TicketIcon size={12} />;
  }
}

/**
 * Renders a bare Linear URL as a compact purple entity chip (icon + `UI-177`
 * or project name). Falls back to a plain link when the URL isn't a
 * recognizable Linear entity. No network — the label comes from the URL.
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

  return (
    <LinkChip
      href={href}
      icon={iconFor(ref)}
      label={linearRefLabel(ref)}
      tone="purple"
    />
  );
}
