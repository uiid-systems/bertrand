import { createFileRoute, Link } from "@tanstack/react-router";
import { type ReactNode, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  Breadcrumbs,
  Card,
  Stack,
  Text,
  Timeline,
} from "@uiid/design-system";
import {
  ArrowLeftRightIcon,
  ClockIcon,
  CpuIcon,
  GitPullRequestIcon,
  HandshakeIcon,
  HourglassIcon,
  MessageSquareMoreIcon,
} from "@uiid/icons";

import { eventsQuery, sessionsQuery, statsQuery } from "../../api/queries";
import {
  eventColor,
  eventTitle,
  formatDuration,
  formatTimestamp,
} from "../../lib/format";
import { useSecondarySidebar } from "../../lib/secondary-sidebar-context";
import { applyTransforms } from "../../lib/timeline/transforms";
import { EventContent } from "../../components/timeline";

export const Route = createFileRoute("/sessions/$sessionId")({
  component: SessionDetail,
});

const RouterLink = ({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) => <Link to={href}>{children}</Link>;

type Crumb = { label: string; value: string };

function buildBreadcrumbs(groupPath: string, sessionName: string): Crumb[] {
  const segments = groupPath.split("/").filter(Boolean);
  const items: Crumb[] = segments.map((segment, i) => ({
    label: segment,
    value: `/groups/${segments.slice(0, i + 1).join("/")}`,
  }));
  items.push({ label: sessionName, value: "" });
  return items;
}

function SessionDetail() {
  const { sessionId } = Route.useParams();
  const { data: sessions = [] } = useQuery(sessionsQuery);
  const { data: rawEvents = [] } = useQuery(eventsQuery(sessionId));
  const events = useMemo(() => applyTransforms(rawEvents), [rawEvents]);
  const { data: stats } = useQuery(statsQuery(sessionId));

  const match = sessions.find((s) => s.session.id === sessionId);
  const breadcrumbs = match
    ? buildBreadcrumbs(match.groupPath, match.session.name)
    : [{ label: sessionId, value: "" }];

  useSecondarySidebar(
    stats ? (
      <Stack gap={4} ax="stretch">
        <Card
          title="Events"
          description="Total events emitted"
          icon={ArrowLeftRightIcon}
          action={<Stat value={stats.eventCount} />}
        />
        <Card
          title="Interactions"
          description="User–Claude exchanges"
          icon={HandshakeIcon}
          action={<Stat value={stats.interactionCount} />}
        />
        <Card
          title="Conversations"
          description="Distinct conversation threads"
          icon={MessageSquareMoreIcon}
          action={<Stat value={stats.conversationCount} />}
        />
        <Card
          title="Duration"
          description="Total session time"
          icon={ClockIcon}
          action={<Stat label={formatDuration(stats.durationS)} />}
        />
        <Card
          title="Claude work"
          description="Time Claude spent active"
          icon={CpuIcon}
          action={<Stat label={formatDuration(stats.claudeWorkS)} />}
        />
        <Card
          title="User wait"
          description="Time user spent waiting"
          icon={HourglassIcon}
          action={<Stat label={formatDuration(stats.userWaitS)} />}
        />
        {stats.prCount > 0 && (
          <Card
            title="PRs"
            description="Pull requests created"
            icon={GitPullRequestIcon}
            action={<Stat value={stats.prCount} />}
          />
        )}
      </Stack>
    ) : null,
  );

  return (
    <Stack ax="stretch" fullwidth style={{ overflow: "hidden" }}>
      <Stack bb={1} p={4}>
        <Breadcrumbs items={breadcrumbs} linkAs={RouterLink} />
      </Stack>
      <Stack p={8} ax="stretch" fullwidth style={{ overflowY: "auto" }}>
        {events.length > 0 && (
          <Timeline
            activeIndex={events.length}
            items={events.map((e) => ({
              title: eventTitle(e),
              time: formatTimestamp(e.createdAt),
              color: eventColor(e.event),
              content: <EventContent event={e} />,
            }))}
            ItemProps={{ style: { width: "100%" } }}
            ContentProps={{ fullwidth: true }}
          />
        )}
      </Stack>
    </Stack>
  );
}

const Stat = ({ value, label }: { value?: number; label?: string }) => (
  <Text size={3} family="mono" weight="bold">
    {label ?? value}
  </Text>
);
Stat.displayName = "Stat";
