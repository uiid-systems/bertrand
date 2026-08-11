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
import { ChevronDownIcon, ChevronRightIcon } from "@uiid/icons";

import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  Group,
  Number,
  Resizable,
  ResizableHandle,
  ResizablePanel,
  Stack,
  Status,
  type StatusProps,
  Text,
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
import { TimelineActions } from "../components/timeline/timeline-actions";
import { hasWorkDetail, workTitle } from "../components/timeline/work_content";
import { SessionStartedContent } from "../components/timeline/session_started_content";
import { SecondarySidebar } from "../components/secondary-sidebar";
import { ContentZone, useOpenZone } from "../components/content-zone";
import {
  SessionTerminal,
  TerminalFontSizeControls,
  type SessionTerminalState,
} from "../components/terminal";
import { CopyResumeButton } from "../components/copy-resume-button";
import { OpenInEditorButton } from "../components/open-in-editor-button";
import { OpenOnGithubButton } from "../components/open-on-github-button";
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

  // Conversations the exit panel can resume into, newest first. Derived from
  // the segments the timeline already built rather than a new endpoint.
  // `segmentConversations` groups legacy null conversation_ids under the
  // sentinel "unknown", which is not an id the server could resolve — those
  // rows are droppable here because resuming into one is not a thing.
  const resumable = useMemo(
    () =>
      segments
        .filter((s) => s.conversationId !== "unknown")
        .map((s) => ({
          conversationId: s.conversationId,
          ordinal: s.ordinal,
          title: s.title,
        }))
        .reverse(),
    [segments],
  );

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
          <OpenInEditorButton
            session={match.session}
            projectSlug={projectSlug}
          />
          <OpenOnGithubButton projectSlug={projectSlug} />
          <ArchiveToggle session={match.session} project={projectSlug} />
        </Group>
      </Group>
      <Stack fullwidth style={{ flex: 1, minHeight: 0 }}>
        <Resizable direction="horizontal">
          <ResizablePanel>
            <SessionZones
              sessionId={sessionId}
              segments={segments}
              // A finished session has no PTY to attach to; the same zone
              // carries its exit panel instead (#214).
              exit={
                isLive ? null : (
                  <SessionExitPanel
                    session={match.session}
                    categoryPath={match.categoryPath}
                    exitCode={exitCode}
                    conversationCount={segments.length}
                    conversations={resumable}
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
 * The second zone's identity in the accordion. Deliberately one id across both
 * of its states: what's stored is *which slot the reader wants open*, and this
 * is one slot showing whichever of the two applies. Keying them separately would
 * mean a finished session, whose slot holds the exit panel, opened with
 * everything collapsed just because the last live session had its terminal up.
 */
const SECONDARY_ZONE_ID = "secondary";

/**
 * A session's main content area: the timeline plus a second zone, stacked as
 * two collapsible zones in one full-height flex column.
 *
 * The second zone is the session's terminal while it runs and its exit panel
 * once it has ended (#214). Both are "the thing happening to this session right
 * now", they occupy the same space, and only one can ever apply — so they share
 * one slot rather than introducing a third zone that is empty half the time.
 *
 * The two zones are an **accordion**: opening one closes the other, and closing
 * the open one leaves the column as a pair of trigger bars. So the reader picks
 * a surface to read rather than a split to divide, and every zone is either
 * full-height or absent — there is no in-between share to tune, and no state in
 * which two half-height zones are both too short to be useful. `useOpenZone`
 * holds the single open id, so opening a zone needs no matching close.
 *
 * The column *is* the sizing mechanism: an open zone absorbs the leftover
 * height, a collapsed one shrinks to its trigger bar, so a click hands over the
 * whole column by pure layout with nothing to measure or keep in sync.
 *
 * Which zone is open persists (`useOpenZone`) but the terminal itself is scoped
 * to this view: navigating to another session unmounts it, which detaches the
 * websocket. That's deliberate — several sessions can be live at once, and a
 * terminal that outlived its route would show a different session's PTY than the
 * timeline beside it.
 */
const SessionZones = ({
  sessionId,
  segments,
  exit,
}: {
  readonly sessionId: string;
  /** Feeds both the timeline body and its header's jump list, so a card and its
   *  entry in that list can never describe different things. */
  readonly segments: ConversationSegment[];
  /** Present once the session has ended; renders instead of the terminal. */
  readonly exit: ReactNode | null;
}) => {
  // The timeline is what a session is *about*, so it holds the column until the
  // reader says otherwise; the terminal has to be asked for.
  const { open: timelineOpen, setOpen: setTimelineOpen } = useOpenZone(
    "timeline",
    { defaultOpen: true },
  );
  const { open: terminalOpen, setOpen: setTerminalOpen } =
    useOpenZone(SECONDARY_ZONE_ID);

  const [terminal, setTerminal] = useState<SessionTerminalState | null>(null);

  // Cards actually rendered, not raw events — transforms fold runs of tool
  // calls into one card, so this counts what the timeline shows.
  const cardCount = segments.reduce((n, s) => n + s.events.length, 0);

  return (
    <Stack ax="stretch" fullwidth fullheight style={{ minHeight: 0 }}>
      <ContentZone
        data-slot="timeline-zone"
        title="Timeline"
        open={timelineOpen}
        onOpenChange={setTimelineOpen}
        badge={
          cardCount === 0 ? null : (
            <Badge size="small" color="neutral">
              <Number size={-1} weight="bold" family="mono" value={cardCount} />
            </Badge>
          )
        }
        actions={
          <TimelineActions
            segments={segments}
            open={timelineOpen}
            onOpen={() => setTimelineOpen(true)}
          />
        }
        // Every prompt, reply, and answer in here renders through `Markdown`, so
        // rebuilding the timeline is O(events) parses — enough to stall a long
        // session's expand. Hide it while collapsed instead of unmounting it.
        keepMounted
      >
        <TimelineBody segments={segments} />
      </ContentZone>

      <ContentZone
        data-slot={exit ? "session-exit-zone" : "terminal-zone"}
        title={exit ? "Session" : "Terminal"}
        open={terminalOpen}
        onOpenChange={setTerminalOpen}
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
        // Font size only means something for the xterm surface, and only while
        // it's on screen. There is no maximize control: an open zone already
        // has the whole column, and handing it back is what the other zone's
        // trigger bar does.
        actions={terminalOpen && !exit ? <TerminalFontSizeControls /> : null}
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
 * zone header's jump list (and a shared #hash link) scroll to — it
 * lives on the container (not the header) so single-conversation sessions, which
 * render no header, still expose an anchor to jump to.
 *
 * Memoized against the segment's identity (stable for unchanged conversations,
 * see segmentConversations) so a live append rebuilds only the segment that
 * grew instead of every card in the session.
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
        <Stack ax="stretch" gap={4} maxw={960} fullwidth>
          {segment.events.map((e) => (
            <EventCard key={e.id} event={e} vitals={segment.vitals} />
          ))}
        </Stack>
      )}
    </Stack>
  );
});
ConversationSegmentView.displayName = "ConversationSegmentView";

/**
 * One event as a card. The event kind picks the palette hue, and that hue is the
 * card's whole surface — background, border, and foreground together — so the
 * kind reads at a glance the way the rail's colored marker used to convey it: a
 * user prompt is blue, tool work yellow, an agent reply neutral.
 *
 * Because the surface carries the hue, nothing inside the card restates it. The
 * title takes its color from `--palette-on-tint` rather than an explicit hue,
 * and the timestamp is plain mono text: a same-hue Badge resolves to exactly the
 * card's own tint, which would leave it invisible.
 *
 * The timestamp sits in the footer, below the separator CardFooter draws, so the
 * header keeps the title and the turn's activity readout as its only tenants.
 *
 * A work event's title already names what it did ("edited $.tsx (+4 -4)"), so
 * rather than repeat that as a summary row above the diff, the title line *is*
 * the disclosure: clicking it (or the chevron opposite) reveals the detail,
 * which stays closed by default. Every other kind of card shows its content
 * outright — a prompt or a reply is the thing you came to read.
 */
function EventCard({
  event,
  vitals,
}: {
  readonly event: EventRow;
  readonly vitals: ConversationSegment["vitals"];
}) {
  // A consolidated agent turn hides its many work rows, so surface a compact
  // readout (tool calls · reads · file diffs) opposite the title — parity with
  // the folded detail without touching the title itself. Other cards show none.
  const turnStats = agentTurnStats(event);
  const [open, setOpen] = useState(false);
  const collapsible = hasWorkDetail(event);
  const toggle = () => setOpen((v) => !v);

  const timestamp = (
    <Text
      size={-1}
      family="mono"
      style={{ whiteSpace: "nowrap", opacity: 0.7 }}
    >
      {formatTimestamp(event.createdAt)}
    </Text>
  );

  return (
    <Card
      // Anchor every card so the zone header's jump list can scroll to it — and
      // so its scroll-spy can tell which card you're on; the margin keeps the
      // target off the scroll container's top edge.
      id={eventAnchorId(event)}
      style={{ scrollMarginTop: 16 }}
      color={eventColor(event.event)}
      icon={iconOf(event.event)}
      title={collapsible ? workTitle(event) : eventTitle(event)}
      TitleProps={
        collapsible
          ? { onClick: toggle, style: { cursor: "pointer" } }
          : undefined
      }
      action={
        collapsible ? (
          <Group
            gap={2}
            ay="center"
            onClick={toggle}
            style={{ cursor: "pointer" }}
          >
            {turnStats && <AgentTurnSummary event={event} />}
            {open ? (
              <ChevronDownIcon size={14} />
            ) : (
              <ChevronRightIcon size={14} />
            )}
          </Group>
        ) : turnStats ? (
          <AgentTurnSummary event={event} />
        ) : undefined
      }
      footer={timestamp}
    >
      {collapsible && !open ? null : event.event === "claude.started" ? (
        <SessionStartedContent event={event} vitals={vitals} />
      ) : (
        <EventContent event={event} />
      )}
    </Card>
  );
}
EventCard.displayName = "EventCard";

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
      variant="ghost"
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
