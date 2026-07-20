import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Badge, Group, Stack, Table, Text } from "@uiid/design-system";

import { allStatsQuery, sessionsQuery } from "../api/queries";
import type { SessionStatsRow, SessionWithCategory } from "../api/types";
import {
  formatDuration,
  formatRelativeTime,
  statusColor,
  statusLabel,
} from "../lib/format";

const RECENT_LIMIT = 25;

/** One flat row per session, values pre-rendered as nodes/primitives so the
 * shared Table renders them directly (it stringifies non-elements). */
type SessionRow = {
  session: React.ReactNode;
  status: React.ReactNode;
  interactions: number;
  changes: React.ReactNode;
  duration: string;
  updated: string;
};

const COLUMNS = [
  "status",
  "session",
  "interactions",
  "changes",
  "duration",
  "updated",
];

/**
 * The most recently active sessions across the in-scope projects, as a plain
 * stats table — a lightweight overview to sit alongside Worktrees. Rows link
 * back to each session; no filtering or sorting controls yet, deliberately.
 */
function SessionsPage() {
  const { data: sessions = [] } = useQuery(sessionsQuery());
  const { data: stats = {} } = useQuery(allStatsQuery());

  const recent = [...sessions]
    .sort((a, b) => b.session.updatedAt.localeCompare(a.session.updatedAt))
    .slice(0, RECENT_LIMIT);

  const rows = recent.map((entry) => toRow(entry, stats[entry.session.id]));

  return (
    <Stack gap={6} p={6} ax="stretch" fullwidth style={{ overflowY: "auto" }}>
      <Group gap={2} ay="center">
        <Text size={3} weight="bold">
          Recent sessions
        </Text>
        {sessions.length > 0 && (
          <Badge color="blue">{sessions.length}</Badge>
        )}
      </Group>

      {rows.length === 0 ? (
        <Text shade="halftone">No sessions yet</Text>
      ) : (
        <Table<SessionRow>
          items={rows}
          columns={COLUMNS}
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
  const { session, categoryPath } = entry;

  return {
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
