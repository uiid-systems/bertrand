import { createFileRoute, Link } from "@tanstack/react-router";
import {
  type ReactNode,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { Maximize2Icon, Minimize2Icon } from "@uiid/icons";

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
  agentTurnStats,
  eventColor,
  eventTitle,
  formatRelativeTime,
  formatTimestamp,
  isLiveStatus,
  statusColor,
} from "../lib/format";
import { categoryOf } from "../lib/timeline/categories";
import { iconOf } from "../lib/timeline/icons";
import {
  eventAnchorId,
  segmentConversations,
  type ConversationSegment,
} from "../lib/timeline/segments";
import { useMatchedSession } from "../lib/use-matched-session";
import { useSessions } from "../lib/use-sessions";
import { EventContent } from "../components/timeline";
import { AgentTurnSummary } from "../components/timeline/agent_turn_summary";
import { SessionStartedContent } from "../components/timeline/session_started_content";
import { SecondarySidebar } from "../components/secondary-sidebar";
import { ContentZone, useZoneCollapse } from "../components/content-zone";
import {
  SessionTerminal,
  TerminalFontSizeControls,
  type SessionTerminalState,
} from "../components/terminal";
import { CopyResumeButton } from "../components/copy-resume-button";
import { SessionExitPanel } from "../components/session-exit";
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

  // The exit code the session finished on, read from the durable event log
  // rather than the relay's `ended` frame (#215). A browser that opened this
  // route after the session ended never received that frame, and one that was
  // attached has since had the terminal replaced — so the frame can't be the
  // source here. Last `claude.ended` wins: a resumed session emits one per run.
  const exitCode = useMemo(() => {
    for (let i = rawEvents.length - 1; i >= 0; i--) {
      const event = rawEvents[i]!;
      if (event.event !== "claude.ended") continue;
      const meta = event.meta as Record<string, unknown> | null;
      const code = meta?.exit_code;
      return typeof code === "number" ? code : null;
    }
    return null;
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
            <SessionZones
              sessionId={sessionId}
              timeline={<TimelineBody segments={segments} />}
              // A finished session has no PTY to attach to; the same zone
              // carries its exit panel instead (#214).
              exit={
                isLive ? null : (
                  <SessionExitPanel
                    session={match.session}
                    categoryPath={match.categoryPath}
                    exitCode={exitCode}
                    conversationCount={segments.length}
                    project={projectSlug}
                  />
                )
              }
            />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize={460} minSize={360} maxSize={640}>
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

const TimelineBody = ({
  segments,
}: {
  readonly segments: ConversationSegment[];
}) => (
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
);
TimelineBody.displayName = "TimelineBody";

/**
 * Share of the column the terminal takes while the timeline is also open. A
 * proportion rather than a pixel height so the split holds its shape on a laptop
 * and on a tall monitor alike, and so neither zone can ever be squeezed to
 * nothing: the two bases always add up to less than the column.
 */
const TERMINAL_ZONE_SHARE = "45%";

/**
 * A session's main content area: the timeline plus a second zone, stacked as
 * two collapsible zones in one full-height flex column.
 *
 * The second zone is the session's terminal while it runs and its exit panel
 * once it has ended (#214). Both are "the thing happening to this session right
 * now", they occupy the same space, and only one can ever apply — so they share
 * one slot rather than introducing a third zone that is empty half the time.
 *
 * The column *is* the sizing mechanism. Each zone's `flex` says what share it
 * wants — a collapsed zone shrinks to its trigger bar, an open one absorbs
 * everything left over — so collapsing either zone gives the whole column to the
 * other by pure layout, with nothing to measure or keep in sync.
 *
 * Collapse state is persisted (`useZoneCollapse`) but the terminal itself is
 * scoped to this view: navigating to another session unmounts it, which detaches
 * the websocket. That's deliberate — several sessions can be live at once, and a
 * terminal that outlived its route would show a different session's PTY than the
 * timeline beside it.
 *
 * The two states keep *separate* collapse ids. The stored state is global
 * rather than per-session, and the reason terminal collapse is persisted at all
 * — expanding it reattaches a PTY and asks it to repaint — has no equivalent
 * for a static panel. Sharing one id would mean dismissing the exit panel on a
 * finished session silently collapsed the terminal on every live one.
 *
 * "Maximize" is just collapsing the timeline zone, which keeps one mechanism
 * instead of introducing a second sizing path.
 */
const SessionZones = ({
  sessionId,
  timeline,
  exit,
}: {
  readonly sessionId: string;
  readonly timeline: ReactNode;
  /** Present once the session has ended; renders instead of the terminal. */
  readonly exit: ReactNode | null;
}) => {
  const { open: timelineStoredOpen, setOpen: setTimelineOpen } =
    useZoneCollapse("timeline");
  const { open: terminalOpen, setOpen: setTerminalOpen } = useZoneCollapse(
    exit ? "session-exit" : "terminal",
  );

  const [terminal, setTerminal] = useState<SessionTerminalState | null>(null);

  // Never let both zones be collapsed — that's two trigger bars over a band of
  // dead space. The timeline is the fallback, so collapsing the terminal reopens
  // it, as does arriving with both stored collapsed (which earlier builds of
  // this view could persist).
  const timelineOpen = timelineStoredOpen || !terminalOpen;

  // The other direction needs a nudge rather than a fallback: collapsing the
  // timeline hands the column to the terminal, which has to be open to take it
  // or the click would appear to do nothing.
  const openTimeline = (open: boolean) => {
    setTimelineOpen(open);
    if (!open) setTerminalOpen(true);
  };

  const maximized = !timelineOpen;

  return (
    <Stack ax="stretch" fullwidth fullheight style={{ minHeight: 0 }}>
      <ContentZone
        data-slot="timeline-zone"
        title="Timeline"
        open={timelineOpen}
        onOpenChange={openTimeline}
        // Every prompt, reply, and answer in here renders through `Markdown`, so
        // rebuilding the timeline is O(events) parses — enough to stall a long
        // session's expand. Hide it while collapsed instead of unmounting it.
        keepMounted
      >
        {timeline}
      </ContentZone>

      <ContentZone
        data-slot={exit ? "session-exit-zone" : "terminal-zone"}
        title={exit ? "Session" : "Terminal"}
        open={terminalOpen}
        onOpenChange={setTerminalOpen}
        // Only bounded while it shares the column; with the timeline collapsed
        // the default (fill the leftover space) gives it the full height.
        flex={
          terminalOpen && timelineOpen
            ? `0 1 ${TERMINAL_ZONE_SHARE}`
            : undefined
        }
        // Without a split handle between them, this line is what separates the
        // terminal from the timeline scrolling above it.
        TriggerGroupProps={{ bt: 1 }}
        badge={
          !exit && terminal && terminalOpen ? (
            <Group gap={2} ay="center">
              <Badge
                color={terminal.status === "attached" ? "green" : "neutral"}
              >
                {terminal.status}
              </Badge>
              {terminal.dims && (
                <Text size={0} shade="muted" family="mono">
                  {terminal.dims.cols}×{terminal.dims.rows}
                </Text>
              )}
            </Group>
          ) : null
        }
        actions={
          terminalOpen ? (
            <Group gap={1} ay="center">
              {/* Font size only means something for the xterm surface. */}
              {!exit && <TerminalFontSizeControls />}
              <Button
                size="xsmall"
                variant="ghost"
                shape="square"
                onClick={() => openTimeline(maximized)}
                aria-label={
                  maximized ? "Restore timeline" : "Maximize terminal"
                }
                tooltip={maximized ? "Restore timeline" : "Maximize terminal"}
              >
                {maximized ? (
                  <Minimize2Icon size={13} />
                ) : (
                  <Maximize2Icon size={13} />
                )}
              </Button>
            </Group>
          ) : null
        }
      >
        {exit ?? (
          <SessionTerminal
            sessionId={sessionId}
            onStateChange={setTerminal}
            toolbar={false}
          />
        )}
      </ContentZone>
    </Stack>
  );
};
SessionZones.displayName = "SessionZones";

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
            const turnStats = agentTurnStats(e);
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
              content:
                e.event === "claude.started" ? (
                  <SessionStartedContent event={e} vitals={segment.vitals} />
                ) : (
                  <EventContent event={e} />
                ),
              title: eventTitle(e),
              TitleProps: { color: eventColor(e.event) },
              time: turnStats ? (
                <Group gap={2} ay="center">
                  <AgentTurnSummary event={e} />
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
  const Icon = iconOf(event.event);
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
    </Button>
  );
}
ArchiveToggle.displayName = "ArchiveToggle";
