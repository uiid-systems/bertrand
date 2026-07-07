import { createFileRoute, Link } from "@tanstack/react-router";
import { type ReactNode, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  Badge,
  Breadcrumbs,
  Button,
  Group,
  Sheet,
  Stack,
  Status,
  type StatusProps,
  Text,
  Timeline,
} from "@uiid/design-system";
import { PanelRightIcon } from "@uiid/icons";

import { eventsQuery, projectsQuery, sessionsQuery } from "../api/queries";
import { useSelectedProjects } from "../components/sidebar/selected-projects";
import { useArchiveAction } from "../api/use-archive-action";
import type { EventRow, SessionRow, SessionWithCategory } from "../api/types";
import {
  eventColor,
  eventIcon,
  eventTitle,
  formatTimestamp,
  statusColor,
} from "../lib/format";
import { applyTransforms } from "../lib/timeline/transforms";
import { findSessionFromSplat } from "../lib/find-session-from-splat";
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
  const { projects, queryProjects } = useSelectedProjects();
  const { data: visibleSessions = [] } = useQuery(
    sessionsQuery({ projects: queryProjects }),
  );
  // Fallback list spans every project (and archived rows) so a deep-linked
  // session still resolves even when it belongs to a project the view filter
  // currently hides.
  const { data: allSessions = [] } = useQuery(
    sessionsQuery({
      includeArchived: true,
      projects: projects.map((p) => p.slug),
    }),
  );

  // Resolve session-detail first against the visible list, then the full
  // list (so an archived or filtered-out session opened by deep link still
  // loads even when "show archived" is off in the sidebar).
  const match =
    findSessionFromSplat(_splat, visibleSessions) ??
    findSessionFromSplat(_splat, allSessions);

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
  const isLive =
    match.session.status === "active" || match.session.status === "waiting";

  const { data: rawEvents = [] } = useQuery(
    eventsQuery(sessionId, isLive, projectSlug),
  );
  const events = useMemo(() => applyTransforms(rawEvents), [rawEvents]);

  const pendingQuestion = useMemo(() => {
    if (match.session.status !== "waiting") return null;
    for (let i = rawEvents.length - 1; i >= 0; i--) {
      if (rawEvents[i].event === "session.waiting") {
        const q = rawEvents[i].meta?.question;
        return typeof q === "string" ? q : null;
      }
    }
    return null;
  }, [rawEvents, match.session.status]);

  const breadcrumbs = buildBreadcrumbs(
    projectName,
    match.categoryPath,
    match.session.name,
  );

  return (
    <Stack ax="stretch" fullwidth style={{ overflow: "hidden" }}>
      <Group bb={1} px={4} py={2} ay="center" ax="space-between" fullwidth>
        <Breadcrumbs items={breadcrumbs} linkAs={RouterLink} />
        <Group ay="center" gap={2}>
          <CopyResumeButton
            session={match.session}
            categoryPath={match.categoryPath}
          />
          <ArchiveToggle session={match.session} />
          <Sheet
            side="right"
            title="Session stats"
            trigger={
              <Button tooltip="Session stats" variant="subtle" size="small">
                <PanelRightIcon />
              </Button>
            }
          >
            <SecondarySidebar
              sessionId={sessionId}
              isLive={isLive}
              projectSlug={projectSlug}
            />
          </Sheet>
        </Group>
      </Group>
      <Stack p={8} ax="stretch" fullwidth style={{ overflowY: "auto" }}>
        {events.length > 0 && (
          <Timeline
            activeIndex={events.length}
            items={events.map((e) => ({
              title: eventTitle(e),
              time: formatTimestamp(e.createdAt),
              color: eventColor(e.event),
              media: <EventMedia event={e} />,
              content: <EventContent event={e} />,
            }))}
            ItemProps={{
              style: { width: "100%" },
              ContentProps: { fullwidth: true, maxw: 860, pb: 4 },
            }}
          />
        )}
      </Stack>
      <SessionFooter
        session={match.session}
        pendingQuestion={pendingQuestion}
      />
    </Stack>
  );
}
SessionDetail.displayName = "SessionDetail";

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

function ArchiveToggle({ session }: { readonly session: SessionRow }) {
  const action = useArchiveAction(session);
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

type SessionFooterProps = {
  readonly session: SessionRow;
  readonly pendingQuestion: string | null;
};

function SessionFooter({ session, pendingQuestion }: SessionFooterProps) {
  const color = statusColor(session.status) as StatusProps["color"];
  const isLive = session.status === "active" || session.status === "waiting";

  return (
    <Stack bt={1} p={4} gap={3} fullwidth>
      <Group ay="center" gap={2} fullwidth>
        <Status color={color} pulse={isLive} />
        <Badge color={color}>{session.status}</Badge>
        {pendingQuestion && (
          <Text size={1} shade="muted">
            {pendingQuestion}
          </Text>
        )}
      </Group>
    </Stack>
  );
}
SessionFooter.displayName = "SessionFooter";
