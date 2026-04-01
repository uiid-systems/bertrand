import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { GitBranchIcon } from "@hugeicons/core-free-icons";

import { Accordion, Badge, Group, Stack, Text } from "@uiid/design-system";

import { useWorktrees } from "@/hooks/useWorktrees";
import { StatusDot } from "@/components/status-dot";
import { parseSessionName } from "@/lib/sessions";
import type { Session, Worktree } from "@/lib/types";

function WorktreeTrigger({
  worktree,
  sessions,
}: {
  worktree: Worktree;
  sessions: Session[];
}) {
  const matchedSessions = sessions.filter((s) =>
    worktree.sessions.includes(s.session),
  );

  return (
    <Group gap={2} ay="center">
      <HugeiconsIcon icon={GitBranchIcon} size={12} />
      <Text size={-1} weight="bold" className="font-mono">
        {worktree.branch}
      </Text>
      <Badge size="small" color="blue">
        {worktree.sessions.length}{" "}
        {worktree.sessions.length === 1 ? "session" : "sessions"}
      </Badge>
      {worktree.files.length > 0 && (
        <Group gap={2} ay="center">
          <Badge size="small" color="purple">
            {worktree.files.length}{" "}
            {worktree.files.length === 1 ? "file" : "files"}
          </Badge>
          {worktree.total_additions > 0 && (
            <Text size={-2} className="text-green-500">
              +{worktree.total_additions}
            </Text>
          )}
          {worktree.total_deletions > 0 && (
            <Text size={-2} className="text-red-400">
              -{worktree.total_deletions}
            </Text>
          )}
        </Group>
      )}
      {matchedSessions.length > 0 && (
        <Group gap={1} ay="center">
          {matchedSessions.map((s) => (
            <StatusDot key={s.session} status={s.status} />
          ))}
        </Group>
      )}
    </Group>
  );
}

function WorktreeContent({ worktree }: { worktree: Worktree }) {
  if (worktree.files.length === 0) {
    return (
      <Text size={-1} shade="muted" className="py-2">
        no file changes
      </Text>
    );
  }

  return (
    <Stack gap={0}>
      {worktree.files.map((file) => (
        <Group
          key={file.path}
          gap={2}
          ay="center"
          className="py-0.5 border-b border-border last:border-b-0"
        >
          <Text
            size={-2}
            className="min-w-[4ch] text-right text-green-500"
          >
            +{file.additions}
          </Text>
          <Text
            size={-2}
            className="min-w-[4ch] text-right text-red-400"
          >
            -{file.deletions}
          </Text>
          <Text size={-2} className="font-mono truncate">
            {file.path}
          </Text>
        </Group>
      ))}
    </Stack>
  );
}

export function WorktreeList({ sessions }: { sessions: Session[] }) {
  const { data: worktrees, isLoading } = useWorktrees();
  const [openItems, setOpenItems] = useState<string[]>([]);

  if (isLoading) {
    return (
      <div className="p-10 text-center text-muted-foreground">loading...</div>
    );
  }

  if (!worktrees || worktrees.length === 0) {
    return (
      <div className="p-10 text-center text-muted-foreground">
        no active worktrees
      </div>
    );
  }

  const items = worktrees.map((wt) => ({
    value: wt.branch,
    trigger: <WorktreeTrigger worktree={wt} sessions={sessions} />,
    content: <WorktreeContent worktree={wt} />,
  }));

  return (
    <Accordion
      items={items}
      value={openItems}
      onValueChange={setOpenItems}
      multiple
      TriggerProps={{ className: "!py-2 *:!text-xs" }}
      PanelProps={{ className: "*:w-full" }}
    />
  );
}
