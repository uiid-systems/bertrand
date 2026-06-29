import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import {
  Button,
  Group,
  Input,
  Kbd,
  List,
  ListItem,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuRoot,
  MenuTrigger,
  Popover,
  Stack,
  Status,
  type StatusProps,
  Text,
  Toggle,
  ToggleButton,
  ToggleGroup,
  Tooltip,
} from "@uiid/design-system";
import {
  TagsIcon,
  ClockIcon,
  Copy,
  EyeIcon,
  EyeOffIcon,
  FilesIcon,
  GroupIcon,
  MessageSquareTextIcon,
  MoreHorizontalIcon,
  SearchIcon,
} from "@uiid/icons";

import { allStatsQuery, recapsQuery, sessionsQuery } from "../../api/queries";
import { useArchiveAction } from "../../api/use-archive-action";
import type { SessionRow, SessionWithCategory } from "../../api/types";
import { formatRelativeTime, statusColor } from "../../lib/format";

import { Markdown } from "../markdown";
import { ProjectSwitcher } from "./project-switcher";
import { SidebarWrapper, type SidebarWrapperProps } from "./sidebar-wrapper";

export type SidebarProps = {
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

type SessionGroup = {
  key: string;
  category: string;
  sessions: SessionWithCategory[];
};

function groupSessions(
  sessions: SessionWithCategory[],
  axis: GroupBy,
): SessionGroup[] {
  if (axis === "status") {
    const buckets = new Map<SessionRow["status"], SessionWithCategory[]>();
    for (const s of sessions) {
      const key = s.session.status;
      const list = buckets.get(key);
      if (list) list.push(s);
      else buckets.set(key, [s]);
    }
    return STATUS_ORDER.filter((status) => buckets.has(status)).map(
      (status): SessionGroup => ({
        key: status,
        category: STATUS_LABEL[status],
        sessions: buckets.get(status)!,
      }),
    );
  }

  if (axis === "recent") {
    const now = new Date();
    const buckets = new Map<RecentBucket, SessionWithCategory[]>();
    for (const s of sessions) {
      const key = recentBucketOf(s.session.startedAt, now);
      const list = buckets.get(key);
      if (list) list.push(s);
      else buckets.set(key, [s]);
    }
    return RECENT_ORDER.filter((bucket) => buckets.has(bucket)).map(
      (bucket): SessionGroup => ({
        key: bucket,
        category: RECENT_LABEL[bucket],
        sessions: buckets.get(bucket)!,
      }),
    );
  }

  const groups = new Map<string, SessionWithCategory[]>();
  for (const s of sessions) {
    const key = s.categoryPath;
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }

  return Array.from(
    groups,
    ([category, sessions]): SessionGroup => ({
      key: category,
      category,
      sessions,
    }),
  );
}

export const Sidebar = ({ WrapperProps }: SidebarProps) => {
  const [query, setQuery] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("group");
  const [includeArchived, setIncludeArchived] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: sessions = [] } = useQuery(sessionsQuery({ includeArchived }));

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? sessions.filter(
          (s) =>
            s.session.slug.toLowerCase().includes(q) ||
            s.session.name.toLowerCase().includes(q) ||
            s.categoryPath.toLowerCase().includes(q),
        )
      : sessions;
    return groupSessions(filtered, groupBy);
  }, [sessions, query, groupBy]);

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
      <ProjectSwitcher />
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
      <Group ay="center" ax="space-between" gap={2}>
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
        <Group ay="center" gap={1}>
          <ToggleButton
            size="small"
            shape="square"
            variant="subtle"
            tooltip={includeArchived ? "Hide archived" : "Show archived"}
            pressed={includeArchived}
            onPressedChange={setIncludeArchived}
            icon={{
              unpressed: <EyeOffIcon />,
              pressed: <EyeIcon />,
            }}
          />
        </Group>
      </Group>
      {groups.length === 0 ? (
        <Text size={-1} shade="muted" style={{ padding: "0.5rem" }}>
          No sessions match "{query}".
        </Text>
      ) : (
        <Stack ax="stretch" gap={3} fullwidth>
          {groups.map((group) => (
            <SessionGroupSection key={group.key} group={group} />
          ))}
        </Stack>
      )}
    </SidebarWrapper>
  );
};
Sidebar.displayName = "Sidebar";

type SessionGroupSectionProps = {
  group: SessionGroup;
};

const SessionGroupSection = ({ group }: SessionGroupSectionProps) => (
  <Stack data-slot="sidebar-list-section" ax="stretch" gap={1} fullwidth>
    <Group ay="center" gap={2} py={1} fullwidth>
      <Text render={<h3 />} weight="bold" size={0}>
        {group.category}
      </Text>
      <Text size={-1} shade="muted">
        {group.sessions.length}
      </Text>
    </Group>
    <List data-slot="sidebar-list" marker="none" ax="stretch" gap={1} fullwidth>
      {group.sessions.map((s) => (
        <SessionListItem key={s.session.id} session={s} />
      ))}
    </List>
  </Stack>
);
SessionGroupSection.displayName = "SessionGroupSection";

const SessionListItem = ({ session: s }: { session: SessionWithCategory }) => {
  const color = statusColor(s.session.status) as StatusProps["color"];
  const isArchived = s.session.status === "archived";
  return (
    <ListItem
      data-archived={isArchived ? "" : undefined}
      style={isArchived ? { opacity: 0.4 } : undefined}
    >
      <Stack gap={1} fullwidth>
        <Group ay="center" ax="space-between" gap={2} fullwidth>
          <Group ay="center" gap={2}>
            {/** @todo add {s.session.status} as tooltip */}
            <Status color={color} />
            <SessionLabel session={s} />
          </Group>
          <SessionRowActions
            session={s.session}
            categoryPath={s.categoryPath}
          />
        </Group>
        <SessionContent session={s} />
      </Stack>
    </ListItem>
  );
};
SessionListItem.displayName = "SessionListItem";

const SessionLabel = ({ session: s }: { session: SessionWithCategory }) => (
  <Link to="/$" params={{ _splat: `${s.categoryPath}/${s.session.slug}` }}>
    {s.session.slug}
  </Link>
);
SessionLabel.displayName = "SessionLabel";

const SessionContent = ({ session: s }: { session: SessionWithCategory }) => {
  const { data: sessions = [] } = useQuery(sessionsQuery());
  const hasLiveSession = sessions.some(
    (x) => x.session.status === "active" || x.session.status === "waiting",
  );
  const { data: allStats } = useQuery(allStatsQuery(hasLiveSession));
  const { data: recaps } = useQuery(recapsQuery);
  const stats = allStats?.[s.session.id];
  const recap = recaps?.[s.session.id];
  const linesAdded = stats?.linesAdded ?? 0;
  const linesRemoved = stats?.linesRemoved ?? 0;
  const filesTouched = stats?.filesTouched ?? 0;
  const hasDiff = linesAdded > 0 || linesRemoved > 0;

  return (
    <Group ay="center" gap={2}>
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
      {recap && (
        <Popover
          TriggerProps={{ openOnHover: true }}
          trigger={
            <MessageSquareTextIcon size={12} aria-label="Session recap" />
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
      {s.session.rating !== null && s.session.rating !== undefined && (
        <Text aria-label={`Rated ${s.session.rating} of 5 stars`}>
          {[1, 2, 3, 4, 5]
            .map((n) => (n <= s.session.rating! ? "★" : "☆"))
            .join("")}
        </Text>
      )}
    </Group>
  );
};
SessionContent.displayName = "SessionContent";

type SessionRowActionsProps = {
  session: SessionRow;
  categoryPath: string;
};

const SessionRowActions = ({
  session,
  categoryPath,
}: SessionRowActionsProps) => {
  const action = useArchiveAction(session);
  const { Icon } = action;
  const canCopyResume = session.status === "paused";
  const sessionPath = `${categoryPath}/${session.slug}`;

  return (
    <MenuRoot>
      <MenuTrigger
        render={
          <Button
            variant="ghost"
            size="xsmall"
            shape="square"
            aria-label="Session actions"
          >
            <MoreHorizontalIcon />
          </Button>
        }
      />
      <MenuPortal>
        <MenuPositioner side="bottom" align="end">
          <MenuPopup>
            <MenuItem
              disabled={action.disabled}
              onClick={action.onClick}
              render={<Group ay="center" gap={2} />}
            >
              <Icon size={14} />
              {action.label}
            </MenuItem>
            <MenuItem
              disabled={!canCopyResume}
              onClick={() => {
                void navigator.clipboard.writeText(sessionPath);
              }}
              render={<Group ay="center" gap={2} />}
            >
              <Copy size={14} />
              Copy session path
            </MenuItem>
          </MenuPopup>
        </MenuPositioner>
      </MenuPortal>
    </MenuRoot>
  );
};
SessionRowActions.displayName = "SessionRowActions";
