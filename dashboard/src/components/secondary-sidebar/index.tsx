import { useMatch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { Card, Stack, Text } from "@uiid/design-system";
import {
  ArrowLeftRightIcon,
  ClockIcon,
  CpuIcon,
  GitPullRequestIcon,
  HandshakeIcon,
  HourglassIcon,
  MessageSquareMoreIcon,
} from "@uiid/icons";

import { sessionsQuery, statsQuery } from "../../api/queries";
import type { SessionStatsRow } from "../../api/types";
import { formatDuration } from "../../lib/format";
import {
  SidebarWrapper,
  type SidebarWrapperProps,
} from "../sidebar/sidebar-wrapper";

export const SecondarySidebar = (
  props: Omit<SidebarWrapperProps, "children">,
) => {
  const sessionMatch = useMatch({
    from: "/sessions/$slug",
    shouldThrow: false,
  });
  const slug = sessionMatch?.params?.slug;

  const { data: sessions = [] } = useQuery(sessionsQuery);
  const session = sessions.find((s) => s.session.slug === slug);
  const sessionId = session?.session.id ?? "";

  const { data: stats } = useQuery({
    ...statsQuery(sessionId),
    enabled: !!sessionId,
  });

  return (
    <SidebarWrapper data-slot="secondary-sidebar" {...props}>
      {stats && <SessionStats stats={stats} />}
    </SidebarWrapper>
  );
};
SecondarySidebar.displayName = "SecondarySidebar";

type SessionStatsProps = {
  stats: SessionStatsRow;
};

const SessionStats = ({ stats }: SessionStatsProps) => (
  <Stack gap={4} ax="stretch">
    <Card
      title="Events"
      description="Total events emitted"
      icon={ArrowLeftRightIcon}
      action={<Stat value={stats.eventCount} />}
    />
    <Card
      title="Interactions"
      description="User-Claude exchanges"
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
);
SessionStats.displayName = "SessionStats";

const Stat = ({ value, label }: { value?: number; label?: string }) => (
  <Text size={3} family="mono" weight="bold">
    {label ?? value}
  </Text>
);
Stat.displayName = "Stat";
