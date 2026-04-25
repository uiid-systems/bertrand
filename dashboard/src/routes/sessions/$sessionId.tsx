import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { Card, Stack, Text, Timeline } from "@uiid/design-system";
import {
  ArrowLeftRightIcon,
  ClockIcon,
  CpuIcon,
  GitPullRequestIcon,
  HandshakeIcon,
  HourglassIcon,
  MessageSquareMoreIcon,
} from "@uiid/icons";

import { eventsQuery, statsQuery } from "../../api/queries";
import { eventColor, eventDescription, eventTitle, formatDuration, formatTimestamp } from "../../lib/format";
import { useSecondarySidebar } from "../../lib/secondary-sidebar-context";

export const Route = createFileRoute("/sessions/$sessionId")({
  component: SessionDetail,
});

function SessionDetail() {
  const { sessionId } = Route.useParams();
  const { data: events = [] } = useQuery(eventsQuery(sessionId));
  const { data: stats } = useQuery(statsQuery(sessionId));

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
    <Stack gap={4} ax="stretch" fullwidth>
      {events.length > 0 && (
        <Timeline
          activeIndex={events.length}
          items={events.map((e) => ({
            title: eventTitle(e),
            description: eventDescription(e),
            time: formatTimestamp(e.createdAt),
            color: eventColor(e.event),
          }))}
          DescriptionProps={{ style: { maxWidth: 360 } }}
        />
      )}
    </Stack>
  );
}

const Stat = ({ value, label }: { value?: number; label?: string }) => (
  <Text size={3} family="mono" weight="bold">
    {label ?? value}
  </Text>
);
Stat.displayName = "Stat";
