import { createFileRoute, Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo } from "react";
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

import { eventsQuery, projectsQuery, sessionsQuery } from "../api/queries";
import { useSelectedProjects } from "../components/sidebar/selected-projects";
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
} from "../lib/format";
import {
  segmentConversations,
  type ConversationSegment,
} from "../lib/timeline/segments";
import { useMatchedSession } from "../lib/use-matched-session";
import { EventContent } from "../components/timeline";
import { SecondarySidebar } from "../components/secondary-sidebar";
import { ConversationNav } from "../components/conversation-nav";
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
  const { queryProjects } = useSelectedProjects();
  const { data: visibleSessions = [] } = useQuery(
    sessionsQuery({ projects: queryProjects }),
  );

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
  const segments = useMemo(() => segmentConversations(rawEvents), [rawEvents]);

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
      <Group
        ay="center"
        ax="space-between"
        px={4}
        py={2}
        gap={4}
        bb={1}
        fullwidth
      >
        <Group ay="center" gap={2}>
          <Status color={statusDotColor} pulse={isLive} />
          <Breadcrumbs items={breadcrumbs} linkAs={RouterLink} />
        </Group>
        <Group ay="center" gap={2}>
          <ConversationNav segments={segments} />
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
              p={8}
              gap={8}
              ax="stretch"
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
          <ResizablePanel defaultSize={420} minSize={360} maxSize={640}>
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
 * prompt as a subtitle. The header's `id` is the deep-link anchor the
 * conversation dropdown (and future docs rail) scrolls to.
 */
function ConversationSegmentView({
  segment,
  showHeader,
}: {
  readonly segment: ConversationSegment;
  readonly showHeader: boolean;
}) {
  return (
    <Stack ax="stretch" fullwidth gap={4}>
      {showHeader && (
        <Stack id={segment.anchorId} gap={1} style={{ scrollMarginTop: 16 }}>
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
          ContentProps={{ maxw: 680, pb: 6 }}
          items={segment.events.map((e) => ({
            color: eventColor(e.event),
            media: <EventMedia event={e} />,
            content: <EventContent event={e} />,
            title: (
              <Text
                render={<p />}
                weight="bold"
                color={eventColor(e.event)}
                balance
              >
                {eventTitle(e)}
              </Text>
            ),
            time: (
              <Badge color={eventColor(e.event)} size="small">
                <span style={{ whiteSpace: "nowrap" }}>
                  {formatTimestamp(e.createdAt)}
                </span>
              </Badge>
            ),
          }))}
        />
      )}
    </Stack>
  );
}
ConversationSegmentView.displayName = "ConversationSegmentView";

/** Per-event icon for the timeline's media column, tinted to the rail color. */
function EventMedia({ event }: { readonly event: EventRow }) {
  const Icon = eventIcon(event.event);
  return (
    <Text color={eventColor(event.event)} render={<span />}>
      <Icon size={16} />
    </Text>
  );
}
EventMedia.displayName = "EventMedia";

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
