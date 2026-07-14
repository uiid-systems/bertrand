import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { Badge, Button, Group, Stack, Text } from "@uiid/design-system";
import { ArrowDownToLineIcon, ArrowUpToLineIcon } from "@uiid/icons";

import { eventsQuery } from "../../api/queries";
import type { EventRow } from "../../api/types";
import { eventColor, eventTitle, formatTimestamp } from "../../lib/format";
import {
  eventAnchorId,
  segmentConversations,
  type ConversationSegment,
} from "../../lib/timeline/segments";
import { SidebarZone } from "../sidebar/subcomponents/sidebar-zone";

export type TimelineZoneProps = {
  /** The session the sidebar belongs to — its timeline is the one we index. */
  sessionId: string;
  /** Live sessions poll for new events; paused ones fetch once. */
  isLive?: boolean;
  /** Project the session belongs to, so events resolve against the right DB. */
  projectSlug?: string;
};

/** id of the timeline's scroll container in `$.tsx`; the arrows scroll it. */
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

/**
 * Collapsible "Timeline" section for the secondary sidebar: a table of contents
 * for the individual cards in the main timeline. Each row jumps to that card;
 * when the session spans more than one conversation, cards are grouped under
 * their conversation title. The up/down arrows in the header (where other zones
 * show a count) jump to the top/bottom of the timeline. Reads the same
 * `segmentConversations` selector the timeline renders from — the events query
 * is shared through the react-query cache, so this adds no fetch.
 */
export const TimelineZone = ({
  sessionId,
  isLive,
  projectSlug,
}: TimelineZoneProps) => {
  const { data: rawEvents = [] } = useQuery(
    eventsQuery(sessionId, isLive, projectSlug),
  );
  const segments = useMemo(() => segmentConversations(rawEvents), [rawEvents]);

  const cardCount = segments.reduce((n, s) => n + s.events.length, 0);
  if (cardCount === 0) return null;

  const grouped = segments.length > 1;

  return (
    <SidebarZone
      data-slot="timeline-zone"
      title="Timeline"
      badge={
        <Group gap={2} ay="center" ml="auto">
          {/* Stop clicks on the arrows from reaching the collapsible trigger,
              which would otherwise toggle the zone. The count sits outside this
              group so it reads as the trigger's badge, like the other zones. */}
          <Group gap={1} ay="center" onClick={(e) => e.stopPropagation()}>
            <Button
              size="xsmall"
              variant="ghost"
              shape="square"
              aria-label="Jump to top of timeline"
              tooltip="Jump to top"
              onClick={() => scrollTimeline("top")}
            >
              <ArrowUpToLineIcon size={13} />
            </Button>
            <Button
              size="xsmall"
              variant="ghost"
              shape="square"
              aria-label="Jump to bottom of timeline"
              tooltip="Jump to bottom"
              onClick={() => scrollTimeline("bottom")}
            >
              <ArrowDownToLineIcon size={13} />
            </Button>
          </Group>
          <Badge color="neutral">{cardCount}</Badge>
        </Group>
      }
      PanelProps={{ style: { paddingBlock: 8 } }}
    >
      <Stack px={2} gap={grouped ? 3 : 1} fullwidth ax="stretch">
        {segments.map((seg) =>
          seg.events.length === 0 ? null : (
            <ConversationToc key={seg.anchorId} segment={seg} grouped={grouped} />
          ),
        )}
      </Stack>
    </SidebarZone>
  );
};
TimelineZone.displayName = "TimelineZone";

/** One conversation's cards. The title header shows only when the session has
 * more than one conversation; otherwise the rows sit flush at the zone's edge. */
const ConversationToc = ({
  segment,
  grouped,
}: {
  segment: ConversationSegment;
  grouped: boolean;
}) => (
  <Stack gap={1} fullwidth ax="stretch">
    {grouped && (
      <Group
        className="timeline-toc-item"
        ay="baseline"
        gap={2}
        fullwidth
        style={{ cursor: "pointer" }}
        onClick={() => jumpTo(segment.anchorId)}
      >
        <Text
          className="timeline-toc-title"
          size={-1}
          weight="bold"
          truncate
        >
          {segment.title ?? `Conversation ${segment.ordinal}`}
        </Text>
      </Group>
    )}
    <Stack gap={1} fullwidth ax="stretch" pl={grouped ? 3 : 0}>
      {segment.events.map((event) => (
        <TocRow key={event.id} event={event} />
      ))}
    </Stack>
  </Stack>
);
ConversationToc.displayName = "ConversationToc";

/** A single card's entry — its title, colored to match the timeline card. */
const TocRow = ({ event }: { event: EventRow }) => (
  <Group
    className="timeline-toc-item"
    ay="center"
    gap={2}
    fullwidth
    style={{ cursor: "pointer" }}
    onClick={() => jumpTo(eventAnchorId(event))}
  >
    <Text
      className="timeline-toc-title"
      size={-1}
      color={eventColor(event.event)}
      truncate
      style={{ minWidth: 0, flexGrow: 1 }}
    >
      {eventTitle(event)}
    </Text>
    <Text size={-1} family="mono" shade="muted" style={{ flexShrink: 0 }}>
      {formatTimestamp(event.createdAt)}
    </Text>
  </Group>
);
TocRow.displayName = "TocRow";
