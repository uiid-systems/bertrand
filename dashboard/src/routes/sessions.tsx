import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Badge,
  Group,
  Stack,
  Table,
  Text,
  Toggle,
  ToggleGroup,
} from "@uiid/design-system";

import { sessionsQuery } from "../api/queries";
import type { SessionStatsRow, SessionWithCategory } from "../api/types";
import { useSelectedProject } from "../components/sidebar/selected-project";
import { useAllStats } from "../lib/use-sessions";
import {
  formatDuration,
  formatRelativeTime,
  formatTokens,
  statusColor,
  statusLabel,
} from "../lib/format";

const RECENT_LIMIT = 25;
const RANKED_LIMIT = 10;

/** One flat row per session, values pre-rendered as nodes/primitives so the
 * shared Table renders them directly (it stringifies non-elements). */
type SessionRow = {
  project: React.ReactNode;
  session: React.ReactNode;
  status: React.ReactNode;
  interactions: number;
  changes: React.ReactNode;
  tokens: React.ReactNode;
  duration: string;
  updated: string;
};

type Ranking = "recent" | "changes" | "tokens";

/**
 * The three ways to rank the same list. Each view leads with the column that
 * ranks it, so the ordering is legible without a sort indicator — recent leads
 * with status, the other two with the measure they sort on.
 */
const VIEWS: Record<
  Ranking,
  { label: string; title: string; columns: string[]; empty: string }
> = {
  recent: {
    label: "Recent",
    title: "Recent sessions",
    columns: [
      "status",
      "project",
      "session",
      "interactions",
      "changes",
      "tokens",
      "duration",
      "updated",
    ],
    empty: "No sessions yet",
  },
  changes: {
    label: "Most changed",
    title: "Largest sessions",
    columns: [
      "changes",
      "project",
      "session",
      "status",
      "interactions",
      "tokens",
      "duration",
      "updated",
    ],
    empty: "No changes recorded yet",
  },
  tokens: {
    label: "Most tokens",
    title: "Heaviest sessions",
    columns: [
      "tokens",
      "project",
      "session",
      "status",
      "interactions",
      "changes",
      "duration",
      "updated",
    ],
    empty: "No token usage recorded yet",
  },
};

/** Total lines a session touched — how "large" it ranks. */
function totalChanged(stat: SessionStatsRow | undefined): number {
  return (stat?.linesAdded ?? 0) + (stat?.linesRemoved ?? 0);
}

/**
 * Output tokens — how "heavy" it ranks. Output rather than a sum of all four
 * counters: cache reads run ~100x output, so a total would rank sessions by
 * roughly how long they ran instead of how much work they produced.
 */
function totalTokens(stat: SessionStatsRow | undefined): number {
  return stat?.outputTokens ?? 0;
}

/**
 * A lightweight sessions overview: the most recently active sessions, plus the
 * largest by total lines changed. Rows link back to each session; no filtering
 * or sorting controls yet, deliberately.
 */
function SessionsPage() {
  const { queryProjects } = useSelectedProject();
  const { data: sessions = [] } = useQuery(
    sessionsQuery({ projects: queryProjects }),
  );
  // Superset stats, sliced by this page's own (project-scoped) session list —
  // same numbers as before, but sharing the sidebar's single cache entry.
  const stats = useAllStats();

  const [ranking, setRanking] = useState<Ranking>("recent");

  const rows = useMemo(() => {
    const enriched = sessions.map((entry) => ({
      entry,
      stat: stats[entry.session.id],
      row: toRow(entry, stats[entry.session.id]),
    }));

    if (ranking === "recent") {
      return enriched
        .sort((a, b) =>
          b.entry.session.updatedAt.localeCompare(a.entry.session.updatedAt),
        )
        .slice(0, RECENT_LIMIT)
        .map((e) => e.row);
    }

    // Ranked views drop sessions with nothing to rank — a table of zeroes
    // reads as data when it is really just absence.
    const measure = ranking === "changes" ? totalChanged : totalTokens;
    return enriched
      .filter((e) => measure(e.stat) > 0)
      .sort((a, b) => measure(b.stat) - measure(a.stat))
      .slice(0, RANKED_LIMIT)
      .map((e) => e.row);
  }, [sessions, stats, ranking]);

  const view = VIEWS[ranking];

  return (
    <Stack gap={4} p={6} ax="stretch" fullwidth style={{ overflowY: "auto" }}>
      <Group gap={2} ay="center">
        <Text size={3} weight="bold">
          {view.title}
        </Text>
        {rows.length > 0 && <Badge color="blue">{rows.length}</Badge>}
        <Group ml="auto">
          <ToggleGroup
            value={[ranking]}
            onValueChange={(value) => {
              const next = value[0] as Ranking | undefined;
              // Base UI clears the value when the active toggle is pressed
              // again; keep the current ranking rather than showing nothing.
              if (next) setRanking(next);
            }}
            size="sm"
          >
            {(Object.keys(VIEWS) as Ranking[]).map((key) => (
              <Toggle key={key} value={key} aria-label={VIEWS[key].title}>
                {VIEWS[key].label}
              </Toggle>
            ))}
          </ToggleGroup>
        </Group>
      </Group>

      {rows.length === 0 ? (
        <Text shade="halftone">{view.empty}</Text>
      ) : (
        <Table<SessionRow>
          items={rows}
          columns={view.columns}
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
    tokens: <Tokens stat={stat} />,
    duration: formatDuration(stat?.durationS ?? 0),
    updated: formatRelativeTime(session.updatedAt),
  };
}

/**
 * Output tokens alone — the counter that tracks work produced. Input and the
 * two cache counters are deliberately left to the per-session zone: cache
 * reads run ~100x output and would dominate the column while ranking sessions
 * by little more than how long they ran.
 */
function Tokens({ stat }: { stat: SessionStatsRow | undefined }) {
  const output = stat?.outputTokens ?? 0;
  if (output === 0) return <Text shade="halftone">—</Text>;

  return (
    <Text family="mono" title={`${output.toLocaleString()} output tokens`}>
      {formatTokens(output)}
    </Text>
  );
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
