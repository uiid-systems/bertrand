import { createFileRoute, Link } from "@tanstack/react-router";
import { type ReactNode, memo, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  Badge,
  Breadcrumbs,
  Button,
  Group,
  Resizable,
  ResizableHandle,
  ResizablePanel,
  Stack,
  Status,
  type StatusProps,
  Text,
  Timeline,
} from "@uiid/design-system";

import { eventsQuery, projectsQuery } from "../api/queries";
import { useArchiveAction } from "../api/use-archive-action";
import type { EventRow, SessionRow, SessionWithCategory } from "../api/types";
import {
  eventColor,
  eventIcon,
  eventTitle,
  formatRelativeTime,
  formatTimestamp,
  isLiveStatus,
  statusColor,
  summarizeAgentTurn,
} from "../lib/format";
import { categoryOf } from "../lib/timeline/categories";
import {
  eventAnchorId,
  segmentConversations,
  type ConversationSegment,
} from "../lib/timeline/segments";
import { useMatchedSession } from "../lib/use-matched-session";
import { useSessions } from "../lib/use-sessions";
import { EventContent } from "../components/timeline";
import { SecondarySidebar } from "../components/secondary-sidebar";
import { CopyResumeButton } from "../components/copy-resume-button";
import { SessionItem } from "../components/sidebar/subcomponents/session-item";

export const Route = createFileRoute("/$")({
  component: SplatPage,
});

const RouterLink = ({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) => <Link to={href}>{children}</Link>;

type Crumb = { label: string; value: string };

/**
 * Build breadcrumbs from the project name + a category path. Each category
 * segment links to that category's browse view (`/seg1/seg2/...`); the
 * project name links to home.
 */
function buildBreadcrumbs(
  projectName: string,
  categoryPath: string,
  leafLabel?: string,
): Crumb[] {
  const segments = categoryPath.split("/").filter(Boolean);
  const items: Crumb[] = [{ label: projectName, value: "/" }];
  for (let i = 0; i < segments.length; i++) {
    items.push({
      label: segments[i],
      value: `/${segments.slice(0, i + 1).join("/")}`,
    });
  }
  if (leafLabel !== undefined) items.push({ label: leafLabel, value: "" });
  return items;
}

function SplatPage() {
  const { _splat = "" } = Route.useParams();
  const visibleSessions = useSessions();

  // Resolve session-detail against the visible list, then a full fallback list
  // (see useMatchedSession), so an archived or filtered-out session opened by
  // deep link still loads even when "show archived" is off in the sidebar.
  const match = useMatchedSession(_splat);

  if (match) return <SessionDetail match={match} />;
  return <CategoryDetail categoryPath={_splat} sessions={visibleSessions} />;
}

function useProjectName(): string {
  const { data: projects = [] } = useQuery(projectsQuery);
  return projects.find((p) => p.active)?.name ?? "bertrand";
}

function CategoryDetail({
  categoryPath,
  sessions,
}: {
  readonly categoryPath: string;
  readonly sessions: SessionWithCategory[];
}) {
  const projectName = useProjectName();
  const filtered = sessions.filter((s) => s.categoryPath === categoryPath);
  const breadcrumbs = buildBreadcrumbs(projectName, categoryPath);

  return (
    <Stack gap={4} ax="stretch" fullwidth>
      <Stack
        bb={1}
        p={4}
        style={{
          position: "sticky",
          top: 0,
          backgroundColor: "var(--shade-background)",
          zIndex: 1,
        }}
      >
        <Breadcrumbs items={breadcrumbs} linkAs={RouterLink} />
      </Stack>
      <Stack px={8} gap={2} style={{ overflow: "auto" }}>
        {filtered.length > 0 ? (
          filtered.map((s) => <SessionItem key={s.session.id} session={s} />)
        ) : (
          <Text shade="muted">No sessions in this category.</Text>
        )}
      </Stack>
    </Stack>
  );
}
CategoryDetail.displayName = "CategoryDetail";

function SessionDetail({ match }: { readonly match: SessionWithCategory }) {
  const activeProjectName = useProjectName();
  const projectSlug = match.project?.slug;
  const projectName = match.project?.name ?? activeProjectName;
  const sessionId = match.session.id;
  const isLive = isLiveStatus(match.session.status);
  const statusDotColor = statusColor(
    match.session.status,
  ) as StatusProps["color"];

  const { data: rawEvents = [] } = useQuery(
    eventsQuery(sessionId, isLive, projectSlug),
  );
  // Threading the previous result through keeps finished conversations
  // identity-stable across live appends, so the memoized segment views below
  // only re-render the conversation that actually changed.
  const prevSegments = useRef<ConversationSegment[]>([]);
  const segments = useMemo(() => {
    const next = segmentConversations(rawEvents, prevSegments.current);
    prevSegments.current = next;
    return next;
  }, [rawEvents]);

  // Deep-link support: once segments render, honour a #conversation-… hash so
  // a shared link scrolls to the right chapter (native fragment scrolling
  // misses because the anchors mount after this async data resolves).
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash || segments.length === 0) return;
    const el = document.getElementById(hash);
    if (el) el.scrollIntoView({ block: "start" });
  }, [segments, sessionId]);

  const breadcrumbs = buildBreadcrumbs(
    projectName,
    match.categoryPath,
    match.session.name,
  );

  return (
    <Stack ax="stretch" fullwidth fullheight style={{ overflow: "hidden" }}>
      {/* Breadcrumb bar spans above both the timeline and the secondary
          sidebar; the horizontal split lives beneath it so the crumbs get the
          full width to breathe. */}
      <Group ay="center" ax="space-between" p={2} gap={4} bb={1} fullwidth>
        <Group ay="center" gap={2}>
          <Status color={statusDotColor} pulse={isLive} />
          <Breadcrumbs items={breadcrumbs} linkAs={RouterLink} />
        </Group>
        <Group ay="center" gap={2}>
          <CopyResumeButton
            session={match.session}
            categoryPath={match.categoryPath}
          />
          <ArchiveToggle session={match.session} project={projectSlug} />
        </Group>
      </Group>
      <Stack fullwidth style={{ flex: 1, minHeight: 0 }}>
        <Resizable direction="horizontal">
          <ResizablePanel>
            <Stack
              id="timeline-scroll"
              ax="stretch"
              p={4}
              fullwidth
              fullheight
              style={{ overflowY: "auto" }}
            >
              {segments.map((segment) => (
                <ConversationSegmentView
                  key={segment.conversationId}
                  segment={segment}
                  showHeader={segments.length > 1}
                />
              ))}
            </Stack>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize={560} minSize={360} maxSize={640}>
            <SecondarySidebar
              sessionId={sessionId}
              isLive={isLive}
              projectSlug={projectSlug}
            />
          </ResizablePanel>
        </Resizable>
      </Stack>
    </Stack>
  );
}
SessionDetail.displayName = "SessionDetail";

/**
 * One conversation's timeline. When the session has more than one conversation,
 * a header carries the ordinal, event count, relative start, and the first user
 * prompt as a subtitle. The segment container's `id` is the deep-link anchor the
 * sidebar's Timeline table-of-contents (and a shared #hash link) scroll to — it
 * lives on the container (not the header) so single-conversation sessions, which
 * render no header, still expose an anchor to jump to.
 *
 * Memoized against the segment's identity (stable for unchanged conversations,
 * see segmentConversations) so a live append rebuilds only the segment that
 * grew instead of every Timeline in the session.
 */
const ConversationSegmentView = memo(function ConversationSegmentView({
  segment,
  showHeader,
}: {
  readonly segment: ConversationSegment;
  readonly showHeader: boolean;
}) {
  return (
    <Stack
      id={segment.anchorId}
      ax="stretch"
      fullwidth
      gap={4}
      pb={52}
      style={{ scrollMarginTop: 16 }}
    >
      {showHeader && (
        <Stack gap={1}>
          <Group ay="baseline" gap={2}>
            <Text weight="semibold">Conversation {segment.ordinal}</Text>
            <Text size={1} shade="muted">
              {segment.eventCount} events ·{" "}
              {formatRelativeTime(segment.startedAt)}
            </Text>
          </Group>
          {segment.title && (
            <Text size={1} shade="muted" truncate>
              {segment.title}
            </Text>
          )}
        </Stack>
      )}
      {segment.events.length > 0 && (
        <Timeline
          activeIndex={segment.events.length}
          gap={6}
          ContentProps={{ maxw: 960, pt: 0, pb: 6 }}
          items={segment.events.map((e) => {
            // A consolidated agent turn hides its many work rows, so surface a
            // compact readout (tool calls · reads · file diffs) beside the
            // timestamp — parity with the folded detail without touching the
            // title. Other cards keep the bare timestamp.
            const turnSummary = summarizeAgentTurn(e);
            const timestamp = (
              <Badge color={eventColor(e.event)} size="small">
                <span style={{ whiteSpace: "nowrap" }}>
                  {formatTimestamp(e.createdAt)}
                </span>
              </Badge>
            );
            return {
              // Anchor every card so the sidebar table-of-contents can scroll to
              // it; the margin keeps the target off the container's top edge.
              id: eventAnchorId(e),
              style: { scrollMarginTop: 16 },
              color: eventColor(e.event),
              marker: <EventMarker event={e} />,
              content: <EventContent event={e} />,
              title: eventTitle(e),
              TitleProps: { color: eventColor(e.event) },
              time: turnSummary ? (
                <Group gap={2} ay="center">
                  <Text size={-1} shade="muted" style={{ whiteSpace: "nowrap" }}>
                    {turnSummary}
                  </Text>
                  {timestamp}
                </Group>
              ) : (
                timestamp
              ),
              // Lifecycle rows are just an id/exit badge — no card surface.
              CardProps:
                categoryOf(e.event) === "lifecycle"
                  ? { variant: "ghost" as const }
                  : undefined,
            };
          })}
        />
      )}
    </Stack>
  );
});
ConversationSegmentView.displayName = "ConversationSegmentView";

/** Per-event icon rendered inside the timeline marker on the rail. */
function EventMarker({ event }: { readonly event: EventRow }) {
  const Icon = eventIcon(event.event);
  return <Icon size={12} />;
}
EventMarker.displayName = "EventMarker";

function ArchiveToggle({
  session,
  project,
}: {
  readonly session: SessionRow;
  readonly project?: string;
}) {
  const action = useArchiveAction(session, project);
  const { Icon } = action;
  return (
    <Button
      tooltip={action.tooltip}
      variant="subtle"
      size="small"
      disabled={action.disabled}
      loading={action.loading}
      onClick={action.onClick}
      aria-label={action.label}
    >
      <Icon />
      {action.label} session
    </Button>
  );
}
ArchiveToggle.displayName = "ArchiveToggle";
