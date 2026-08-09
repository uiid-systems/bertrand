import { useCallback, useEffect, useMemo, useState } from "react";

import { Button, Group, Select } from "@uiid/design-system";
import { ArrowDownToLineIcon, ArrowUpToLineIcon, type Icon } from "@uiid/icons";

import { eventTocTitle, formatTimestamp } from "../../lib/format";
import { useScrollSpy } from "../../lib/use-scroll-spy";
import { iconOf } from "../../lib/timeline/icons";
import {
  eventAnchorId,
  type ConversationSegment,
} from "../../lib/timeline/segments";

/** id of the timeline's scroll container in `$.tsx`; these controls scroll it. */
const SCROLL_ID = "timeline-scroll";

function scrollTimeline(to: "top" | "bottom") {
  const el = document.getElementById(SCROLL_ID);
  if (!el) return;
  // Instant jump — the top/bottom arrows can span a very long timeline, and
  // smooth-scrolling that distance is slow and janky.
  el.scrollTo({ top: to === "top" ? 0 : el.scrollHeight });
}

/** Scroll to an anchor; fall back to the top if it isn't mounted. Instant, not
 * smooth — smooth-scrolling inside the nested timeline container is unreliable. */
function jumpTo(anchorId: string) {
  const el = document.getElementById(anchorId);
  if (!el) return scrollTimeline("top");
  el.scrollIntoView({ block: "start" });
  // Reflect the target in the URL so the position is copyable, without a
  // second (native) jump — scrollIntoView already handled the scroll.
  history.replaceState(null, "", `#${anchorId}`);
}

type AnchorItem = {
  value: string;
  label: string;
  icon?: Icon;
  disabled?: boolean;
};

/**
 * The jump list, in timeline order. Every card is an entry, built from the same
 * helpers the card itself renders from — `eventTocTitle` for the label and the
 * event's own icon — so the list reads as a miniature of the timeline beside it.
 * The timestamp rides along in the label: `Select` takes a plain string per
 * item, so it can't be styled as its own muted run without a design-system
 * change (`SelectItem` isn't exported, and `label` is typed `string` because it
 * also feeds base-ui's typeahead).
 *
 * When the session spans more than one conversation each one opens with a
 * disabled row carrying its title. `Select` has no group slot, and a disabled
 * item is skipped by keyboard navigation — which is how a heading should behave.
 */
function anchorItems(segments: ConversationSegment[]): AnchorItem[] {
  const grouped = segments.length > 1;
  const items: AnchorItem[] = [];

  for (const segment of segments) {
    if (segment.events.length === 0) continue;
    if (grouped) {
      items.push({
        value: segment.anchorId,
        label: segment.title ?? `Conversation ${segment.ordinal}`,
        disabled: true,
      });
    }
    for (const event of segment.events) {
      items.push({
        value: eventAnchorId(event),
        label: `${eventTocTitle(event)} (${formatTimestamp(event.createdAt)})`,
        icon: iconOf(event.event),
      });
    }
  }

  return items;
}

export type TimelineActionsProps = {
  /** The same segments the timeline body renders, so the two never disagree. */
  segments: ConversationSegment[];
  /** Whether the timeline zone is expanded. */
  open: boolean;
  /** Expands the zone. A jump into a collapsed timeline has to open it first:
   *  the body is kept mounted but `display: none`, so it has no layout box and
   *  scrolling to an anchor inside it would silently do nothing. */
  onOpen: () => void;
};

/**
 * The timeline zone's header controls: a select that jumps to any card, and
 * arrows to either end. This is the sidebar table-of-contents rehoused — same
 * anchors, same instant scrolling — collapsed into the zone's own trigger bar
 * so navigating the timeline happens where the timeline is.
 */
export const TimelineActions = ({
  segments,
  open,
  onOpen,
}: TimelineActionsProps) => {
  const items = useMemo(() => anchorItems(segments), [segments]);

  // Cards only. A conversation's own anchor wraps every card inside it, so it
  // would hold the top of the spy's band for the whole conversation and beat
  // all of them — and it's a disabled heading, never a selectable value.
  const cardAnchors = useMemo(
    () => segments.flatMap((s) => s.events.map(eventAnchorId)),
    [segments],
  );
  const spied = useScrollSpy({
    containerId: SCROLL_ID,
    anchorIds: cardAnchors,
    enabled: open,
  });
  // The last anchor jumped to. Only shows through before the spy has an answer
  // — on the frame a jump is queued, and while the zone is collapsed, when
  // there's no laid-out container to observe.
  const [anchor, setAnchor] = useState<string | null>(null);
  const [pendingScroll, setPendingScroll] = useState<(() => void) | null>(null);

  // Expanding is a state change, so the timeline has no layout box to scroll
  // within until that has been committed and laid out — one frame's grace.
  useEffect(() => {
    if (!pendingScroll || !open) return;
    const frame = requestAnimationFrame(() => {
      pendingScroll();
      setPendingScroll(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingScroll, open]);

  const scrollTimelineTo = useCallback(
    (scroll: () => void) => {
      if (open) return scroll();
      onOpen();
      setPendingScroll(() => scroll);
    },
    [open, onOpen],
  );

  if (items.length === 0) return null;

  return (
    <Group gap={1} ay="center">
      <Button
        size="xsmall"
        variant="ghost"
        shape="square"
        aria-label="Jump to top of timeline"
        tooltip="Jump to top"
        onClick={() => scrollTimelineTo(() => scrollTimeline("top"))}
      >
        <ArrowUpToLineIcon />
      </Button>
      <Button
        size="xsmall"
        variant="ghost"
        shape="square"
        aria-label="Jump to bottom of timeline"
        tooltip="Jump to bottom"
        onClick={() => scrollTimelineTo(() => scrollTimeline("bottom"))}
      >
        <ArrowDownToLineIcon />
      </Button>
      <Select
        ghost
        items={items}
        value={spied ?? anchor}
        onValueChange={(next: string | null) => {
          if (!next) return;
          setAnchor(next);
          scrollTimelineTo(() => jumpTo(next));
        }}
        placeholder="Jump to…"
        size="small"
        aria-label="Jump to a card in the timeline"
        TriggerProps={{
          style: { width: 220, minWidth: 0 },
        }}
        PositionerProps={{
          align: "end",
          alignItemWithTrigger: false,
        }}
        PopupProps={{ style: { maxWidth: 460 } }}
      />
    </Group>
  );
};
TimelineActions.displayName = "TimelineActions";
