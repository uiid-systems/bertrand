import { useState } from "react";
import { Select } from "@uiid/design-system";
import { MessagesSquareIcon } from "@uiid/icons";

import type { ConversationSegment } from "../lib/timeline/segments";

/**
 * Jump-between-conversations select for the session header.
 *
 * Deliberately a thin, self-contained leaf: it reads the shared
 * `ConversationSegment[]` and scrolls to a segment's anchor on selection.
 * Nothing imports it but the session header, so retiring it in favour of a
 * design-system docs rail later is: delete this file + remove one line from
 * `$.tsx`. The rail would subscribe to the same `segmentConversations` selector
 * and only add scroll-spy.
 */
export function ConversationNav({
  segments,
}: {
  readonly segments: ConversationSegment[];
}) {
  const [value, setValue] = useState<string | undefined>(undefined);

  // Nothing to jump between with a single conversation.
  if (segments.length < 2) return null;

  const items = segments.map((seg) => ({
    value: seg.anchorId,
    label: seg.title ? `#${seg.ordinal}: ${seg.title}` : `#${seg.ordinal}`,
  }));

  const jumpTo = (anchorId: string) => {
    setValue(anchorId);
    const el = document.getElementById(anchorId);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    // Reflect the target in the URL so the link is copyable, without the
    // native jump (scrollIntoView already handled the scroll).
    if (el) history.replaceState(null, "", `#${anchorId}`);
  };

  return (
    <Select
      fullwidth
      items={items}
      value={value}
      onValueChange={(next) => next && jumpTo(next)}
      placeholder="Jump to conversation"
      before={<MessagesSquareIcon />}
      size="small"
      TriggerProps={{ style: { maxWidth: "320px" } }}
    />
  );
}
ConversationNav.displayName = "ConversationNav";
