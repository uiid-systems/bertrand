import { useQuery } from "@tanstack/react-query";

import { Card, Stack, Tabs, Text, type TabProps } from "@uiid/design-system";
import {
  ArrowLeftRightIcon,
  ClockIcon,
  CpuIcon,
  FileDiffIcon,
  FilesIcon,
  HandshakeIcon,
  HourglassIcon,
  MessageSquareMoreIcon,
  Trash2Icon,
  WrenchIcon,
} from "@uiid/icons";

import { engagementQuery, statsQuery } from "../../api/queries";
import type { EngagementStats, SessionStatsRow } from "../../api/types";
import { formatDuration } from "../../lib/format";
import {
  SidebarWrapper,
  type SidebarWrapperProps,
} from "../sidebar/subcomponents/sidebar-wrapper";

export type SecondarySidebarProps = Omit<SidebarWrapperProps, "children"> & {
  sessionId: string;
  isLive: boolean;
  /** Project the session belongs to, so stats resolve against the right DB. */
  projectSlug?: string;
};

export const SecondarySidebar = ({
  sessionId,
  isLive,
  projectSlug,
  ...props
}: SecondarySidebarProps) => {
  const { data: stats } = useQuery({
    ...statsQuery(sessionId, isLive, projectSlug),
    enabled: !!sessionId,
  });

  const { data: engagement } = useQuery({
    ...engagementQuery(sessionId, isLive, projectSlug),
    enabled: !!sessionId,
  });

  return (
    <SidebarWrapper data-slot="secondary-sidebar" {...props} p={0} minw={540}>
      {stats && <SessionStats stats={stats} engagement={engagement} />}
    </SidebarWrapper>
  );
};
SecondarySidebar.displayName = "SecondarySidebar";

type SessionStatsProps = {
  stats: SessionStatsRow;
  engagement?: EngagementStats;
};

function topToolsLabel(toolUsage: Record<string, number>): string {
  return Object.entries(toolUsage)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([tool, count]) => `${tool} ${count}`)
    .join(" · ");
}

const SessionStats = ({ stats, engagement }: SessionStatsProps) => {
  const hasDiff = stats.linesAdded > 0 || stats.linesRemoved > 0;
  const hasFiles = stats.filesTouched > 0;
  const hasCode = hasDiff || hasFiles;

  const toolTotal = engagement
    ? Object.values(engagement.toolUsage).reduce((a, b) => a + b, 0)
    : 0;
  const discardTotal = engagement?.discardRate.total ?? 0;
  const hasEngagement = !!engagement && (toolTotal > 0 || discardTotal > 0);

  const tabs: TabProps[] = [
    {
      label: "Activity",
      value: "activity",
      render: (
        <SectionStack>
          <Card
            title="Conversations"
            description="Distinct conversation threads"
            icon={MessageSquareMoreIcon}
            action={<Stat value={stats.conversationCount} />}
          />
          <Card
            title="Interactions"
            description="User-Claude exchanges"
            icon={HandshakeIcon}
            action={<Stat value={stats.interactionCount} />}
          />
          <Card
            title="Events"
            description="Total events emitted"
            icon={ArrowLeftRightIcon}
            action={<Stat value={stats.eventCount} />}
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
        </SectionStack>
      ),
    },
  ];

  if (hasCode) {
    tabs.push({
      label: "Code",
      value: "code",
      render: (
        <SectionStack>
          {hasDiff && (
            <Card
              title="Lines changed"
              description="Across all edits"
              icon={FileDiffIcon}
              action={
                <DiffStat
                  added={stats.linesAdded}
                  removed={stats.linesRemoved}
                />
              }
            />
          )}
          {hasFiles && (
            <Card
              title="Files touched"
              description="Distinct files edited"
              icon={FilesIcon}
              action={<Stat value={stats.filesTouched} />}
            />
          )}
        </SectionStack>
      ),
    });
  }

  if (hasEngagement) {
    tabs.push({
      label: "Engagement",
      value: "engagement",
      render: (
        <SectionStack>
          {toolTotal > 0 && (
            <Card
              title="Tracked tool calls"
              description={topToolsLabel(engagement.toolUsage)}
              icon={WrenchIcon}
              action={<Stat value={toolTotal} />}
            />
          )}
          {discardTotal > 0 && (
            <Card
              title="Discarded conversations"
              description={`${engagement.discardRate.discarded} of ${discardTotal}`}
              icon={Trash2Icon}
              action={<Stat value={engagement.discardRate.discarded} />}
            />
          )}
        </SectionStack>
      ),
    });
  }

  return <Tabs items={tabs} fullwidth ContainerProps={{ fullwidth: true }} />;
};
SessionStats.displayName = "SessionStats";

const SectionStack = ({ children }: { children: React.ReactNode }) => (
  <Stack data-slot="section-stack" ax="stretch" pt={4} fullwidth gap={2}>
    {children}
  </Stack>
);
SectionStack.displayName = "SectionStack";

type StatProps = { value: number } | { label: string };
const Stat = (props: StatProps) => (
  <Text data-slot="stat" size={3} family="mono" weight="bold">
    {"label" in props ? props.label : props.value}
  </Text>
);
Stat.displayName = "Stat";

const DiffStat = ({ added, removed }: { added: number; removed: number }) => (
  <Text data-slot="diff-stat" size={3} family="mono" weight="bold">
    <Text color="green" family="mono" weight="bold">
      {`+${added}`}
    </Text>
    {" / "}
    <Text color="red" family="mono" weight="bold">
      {`-${removed}`}
    </Text>
  </Text>
);
DiffStat.displayName = "DiffStat";
