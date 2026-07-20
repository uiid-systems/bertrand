import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Badge, Group, Stack, Table, Text } from "@uiid/design-system";

import { allStatsQuery, sessionsQuery } from "../api/queries";
import type { SessionStatsRow, SessionWithCategory } from "../api/types";
import { useSelectedProjects } from "../components/sidebar/selected-projects";
import {
  formatDuration,
  formatRelativeTime,
  isLiveStatus,
  statusColor,
  statusLabel,
} from "../lib/format";

const RECENT_LIMIT = 25;
const LARGEST_LIMIT = 10;

/** One flat row per session, values pre-rendered as nodes/primitives so the
 * shared Table renders them directly (it stringifies non-elements). */
type SessionRow = {
  project: React.ReactNode;
  session: React.ReactNode;
  status: React.ReactNode;
  interactions: number;
  changes: React.ReactNode;
  duration: string;
  updated: string;
};

/** Recent leads with status; largest leads with the changes that rank it. */
const RECENT_COLUMNS = [
  "status",
  "project",
  "session",
  "interactions",
  "changes",
  "duration",
  "updated",
];
const LARGEST_COLUMNS = [
  "changes",
  "project",
  "session",
  "status",
  "interactions",
  "duration",
  "updated",
];

/** Total lines a session touched — how "large" it ranks. */
function totalChanged(stat: SessionStatsRow | undefined): number {
  return (stat?.linesAdded ?? 0) + (stat?.linesRemoved ?? 0);
}

/**
 * A lightweight sessions overview to sit alongside Worktrees: the most
 * recently active sessions, plus the largest by total lines changed. Rows link
 * back to each session; no filtering or sorting controls yet, deliberately.
 */
function SessionsPage() {
  const { queryProjects } = useSelectedProjects();
  const { data: sessions = [] } = useQuery(
    sessionsQuery({ projects: queryProjects }),
  );
  const hasLiveSession = sessions.some((s) => isLiveStatus(s.session.status));
  const { data: stats = {} } = useQuery(
    allStatsQuery({ hasLiveSession, projects: queryProjects }),
  );

  const enriched = sessions.map((entry) => ({
    entry,
    stat: stats[entry.session.id],
    row: toRow(entry, stats[entry.session.id]),
  }));

  const recent = [...enriched]
    .sort((a, b) =>
      b.entry.session.updatedAt.localeCompare(a.entry.session.updatedAt),
    )
    .slice(0, RECENT_LIMIT)
    .map((e) => e.row);

  const largest = [...enriched]
    .filter((e) => totalChanged(e.stat) > 0)
    .sort((a, b) => totalChanged(b.stat) - totalChanged(a.stat))
    .slice(0, LARGEST_LIMIT)
    .map((e) => e.row);

  return (
    <Stack gap={8} p={6} ax="stretch" fullwidth style={{ overflowY: "auto" }}>
      <TableSection
        title="Recent sessions"
        count={sessions.length}
        columns={RECENT_COLUMNS}
        rows={recent}
        empty="No sessions yet"
      />
      <TableSection
        title="Largest sessions"
        count={largest.length}
        columns={LARGEST_COLUMNS}
        rows={largest}
        empty="No changes recorded yet"
      />
    </Stack>
  );
}

function TableSection({
  title,
  count,
  columns,
  rows,
  empty,
}: {
  title: string;
  count: number;
  columns: string[];
  rows: SessionRow[];
  empty: string;
}) {
  return (
    <Stack gap={4} ax="stretch" fullwidth>
      <Group gap={2} ay="center">
        <Text size={3} weight="bold">
          {title}
        </Text>
        {count > 0 && <Badge color="blue">{count}</Badge>}
      </Group>

      {rows.length === 0 ? (
        <Text shade="halftone">{empty}</Text>
      ) : (
        <Table<SessionRow>
          items={rows}
          columns={columns}
          striped
          highlightOnHover
        />
      )}
    </Stack>
  );
}

function toRow(
  entry: SessionWithCategory,
  stat: SessionStatsRow | undefined,
): SessionRow {
  const { session, categoryPath, project } = entry;

  return {
    project: project ? (
      <Text weight="medium">{project.name}</Text>
    ) : (
      <Text shade="halftone">—</Text>
    ),
    session: (
      <Text
        weight="medium"
        render={
          <Link
            to="/$"
            params={{ _splat: `${categoryPath}/${session.slug}` }}
          />
        }
      >
        {categoryPath} / {session.slug}
      </Text>
    ),
    status: (
      <Badge color={statusColor(session.status)}>
        {statusLabel(session.status)}
      </Badge>
    ),
    interactions: stat?.interactionCount ?? 0,
    changes: <Changes stat={stat} />,
    duration: formatDuration(stat?.durationS ?? 0),
    updated: formatRelativeTime(session.updatedAt),
  };
}

function Changes({ stat }: { stat: SessionStatsRow | undefined }) {
  const added = stat?.linesAdded ?? 0;
  const removed = stat?.linesRemoved ?? 0;

  if (added === 0 && removed === 0) {
    return <Text shade="halftone">—</Text>;
  }

  return (
    <Group gap={1} ay="center">
      <Text family="mono" color="green">{`+${added}`}</Text>
      <Text family="mono" color="red">{`-${removed}`}</Text>
    </Group>
  );
}

export const Route = createFileRoute("/sessions")({
  component: SessionsPage,
});
