import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import {
  Badge,
  Group,
  Input,
  Kbd,
  List,
  type ListItemGroupProps,
  type ListItemProps,
  Popover,
  Stack,
  type StatusProps,
  Text,
  Toggle,
  ToggleButton,
  ToggleGroup,
  Tooltip,
} from "@uiid/design-system";
import {
  TagsIcon,
  ChevronsDownUp,
  ChevronsUpDown,
  ClockIcon,
  FilesIcon,
  GroupIcon,
  MessageSquareTextIcon,
  SearchIcon,
} from "@uiid/icons";

import { allStatsQuery, recapsQuery } from "../../api/queries";
import type { SessionRow, SessionWithGroup } from "../../api/types";
import { formatRelativeTime, statusColor } from "../../lib/format";

import { Markdown } from "../markdown";
import { SidebarWrapper, type SidebarWrapperProps } from "./sidebar-wrapper";

export type SidebarProps = {
  sessions: SessionWithGroup[];
  WrapperProps?: SidebarWrapperProps;
};

type GroupBy = "group" | "status" | "recent";

const STATUS_ORDER: SessionRow["status"][] = [
  "active",
  "waiting",
  "paused",
  "archived",
];

const STATUS_LABEL: Record<SessionRow["status"], string> = {
  active: "Active",
  waiting: "Waiting",
  paused: "Paused",
  archived: "Archived",
};

type RecentBucket = "today" | "yesterday" | "thisWeek" | "earlier";

const RECENT_ORDER: RecentBucket[] = [
  "today",
  "yesterday",
  "thisWeek",
  "earlier",
];

const RECENT_LABEL: Record<RecentBucket, string> = {
  today: "Today",
  yesterday: "Yesterday",
  thisWeek: "This week",
  earlier: "Earlier",
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function recentBucketOf(startedAt: string, now: Date): RecentBucket {
  const start = new Date(startedAt);
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const startOfSession = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
  );
  const dayDiff = Math.floor(
    (startOfToday.getTime() - startOfSession.getTime()) / MS_PER_DAY,
  );
  if (dayDiff <= 0) return "today";
  if (dayDiff === 1) return "yesterday";
  if (dayDiff < 7) return "thisWeek";
  return "earlier";
}

function buildListItem(s: SessionWithGroup): ListItemProps {
  const color = statusColor(s.session.status) as StatusProps["color"];
  return {
    value: s.session.id,
    label: <SessionLabel session={s} />,
    content: <SessionContent session={s} />,
    action: <Badge color={color}>{s.session.status}</Badge>,
  } as ListItemProps;
}

function groupSessions(
  sessions: SessionWithGroup[],
  axis: GroupBy,
): ListItemGroupProps[] {
  if (axis === "status") {
    const buckets = new Map<SessionRow["status"], SessionWithGroup[]>();
    for (const s of sessions) {
      const key = s.session.status;
      const list = buckets.get(key);
      if (list) list.push(s);
      else buckets.set(key, [s]);
    }
    return STATUS_ORDER.filter((status) => buckets.has(status)).map(
      (status): ListItemGroupProps => ({
        category: STATUS_LABEL[status],
        collapsible: true,
        items: buckets.get(status)!.map(buildListItem),
      }),
    );
  }

  if (axis === "recent") {
    const now = new Date();
    const buckets = new Map<RecentBucket, SessionWithGroup[]>();
    for (const s of sessions) {
      const key = recentBucketOf(s.session.startedAt, now);
      const list = buckets.get(key);
      if (list) list.push(s);
      else buckets.set(key, [s]);
    }
    return RECENT_ORDER.filter((bucket) => buckets.has(bucket)).map(
      (bucket): ListItemGroupProps => ({
        category: RECENT_LABEL[bucket],
        collapsible: true,
        items: buckets.get(bucket)!.map(buildListItem),
      }),
    );
  }

  const groups = new Map<string, SessionWithGroup[]>();
  for (const s of sessions) {
    const key = s.groupPath;
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }

  return Array.from(
    groups,
    ([category, items]): ListItemGroupProps => ({
      category,
      collapsible: true,
      items: items.map(buildListItem),
    }),
  );
}

const groupKeyOf = (g: ListItemGroupProps) => g.id ?? g.category ?? "";

export const Sidebar = ({ sessions, WrapperProps }: SidebarProps) => {
  const [query, setQuery] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("group");
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? sessions.filter(
          (s) =>
            s.session.slug.toLowerCase().includes(q) ||
            s.session.name.toLowerCase().includes(q) ||
            s.groupPath.toLowerCase().includes(q),
        )
      : sessions;
    return groupSessions(filtered, groupBy);
  }, [sessions, query, groupBy]);

  const groupKeys = items.map(groupKeyOf);
  const allOpen =
    groupKeys.length > 0 && groupKeys.every((key) => openMap[key] !== false);

  const toggleAll = () => {
    const target = !allOpen;
    setOpenMap((prev) => {
      const next = { ...prev };
      for (const key of groupKeys) next[key] = target;
      return next;
    });
  };

  const decoratedItems = items.map((g) => {
    const key = groupKeyOf(g);
    return {
      ...g,
      open: openMap[key] ?? true,
      onOpenChange: (open: boolean) =>
        setOpenMap((m) => ({ ...m, [key]: open })),
    };
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <SidebarWrapper {...WrapperProps}>
      <Group ay="center" gap={2} fullwidth>
        <Input
          ref={inputRef}
          placeholder="Search for a session"
          before={<SearchIcon />}
          after={<Kbd hotkey={["meta", "k"]} />}
          size="small"
          fullwidth
          style={{ flex: 1, minWidth: 0 }}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </Group>
      <Group ay="center" gap={2}>
        <ToggleGroup
          size="sm"
          value={[groupBy]}
          onValueChange={(value) => {
            const next = value[0] as GroupBy | undefined;
            if (next) setGroupBy(next);
          }}
        >
          <Toggle value="group" aria-label="Group by group">
            <Tooltip trigger={<GroupIcon />}>Group by group</Tooltip>
          </Toggle>
          <Toggle value="status" aria-label="Group by status">
            <Tooltip trigger={<TagsIcon />}>Group by status</Tooltip>
          </Toggle>
          <Toggle value="recent" aria-label="Group by recent">
            <Tooltip trigger={<ClockIcon />}>Group by recent</Tooltip>
          </Toggle>
        </ToggleGroup>
        {items.length > 0 && (
          <ToggleButton
            size="small"
            shape="square"
            variant="subtle"
            tooltip={allOpen ? "Collapse all" : "Expand all"}
            pressed={!allOpen}
            onPressedChange={() => toggleAll()}
            icon={{
              unpressed: <ChevronsDownUp />,
              pressed: <ChevronsUpDown />,
            }}
          />
        )}
      </Group>
      {items.length === 0 ? (
        <Text size={-1} shade="muted" style={{ padding: "0.5rem" }}>
          No sessions match "{query}".
        </Text>
      ) : (
        <List items={decoratedItems} line size="small" />
      )}
    </SidebarWrapper>
  );
};
Sidebar.displayName = "Sidebar";

const SessionLabel = ({ session: s }: { session: SessionWithGroup }) => (
  <Link to="/sessions/$slug" params={{ slug: s.session.slug }}>
    {s.session.slug}
  </Link>
);
SessionLabel.displayName = "SessionLabel";

const SessionContent = ({ session: s }: { session: SessionWithGroup }) => {
  const { data: allStats } = useQuery(allStatsQuery);
  const { data: recaps } = useQuery(recapsQuery);
  const stats = allStats?.[s.session.id];
  const recap = recaps?.[s.session.id];
  const linesAdded = stats?.linesAdded ?? 0;
  const linesRemoved = stats?.linesRemoved ?? 0;
  const filesTouched = stats?.filesTouched ?? 0;
  const hasDiff = linesAdded > 0 || linesRemoved > 0;

  return (
    <Group ay="center" gap={2}>
      {recap && (
        <Popover
          TriggerProps={{ openOnHover: true }}
          trigger={
            <MessageSquareTextIcon
              size={12}
              aria-label="Session recap"
              // style={{ color: "var(--shade-muted)" }}
            />
          }
          title="Session recap"
          description={formatRelativeTime(recap.createdAt)}
          PositionerProps={{ sideOffset: 8, side: "right" }}
          PopupProps={{ style: { maxWidth: 420 } }}
        >
          <Stack my={2}>
            <Markdown>{recap.recap}</Markdown>
          </Stack>
        </Popover>
      )}
      <Text size={-1} shade="muted">
        {formatRelativeTime(s.session.startedAt)}
      </Text>
      {hasDiff && (
        <Group ay="center" gap={1}>
          <Text size={-1} family="mono" color="green">
            {`+${linesAdded}`}
          </Text>
          <Text size={-1} family="mono" color="red">
            {`-${linesRemoved}`}
          </Text>
        </Group>
      )}
      {filesTouched > 0 && (
        <Group ay="center" gap={1}>
          <FilesIcon size={12} />
          <Text size={-1} family="mono" shade="muted">
            {filesTouched}
          </Text>
        </Group>
      )}
    </Group>
  );
};
SessionContent.displayName = "SessionContent";
