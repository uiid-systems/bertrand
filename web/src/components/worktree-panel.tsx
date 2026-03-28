import { useState } from "react";

import { Badge, Group, Stack, Text } from "@uiid/design-system";

import { GitBranchIcon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { Session } from "@/lib/types";
import { parseSessionName } from "@/lib/sessions";
import { StatusDot } from "@/components/status-dot";

type WorktreeGroup = {
  branch: string;
  sessions: Session[];
};

function groupByWorktree(sessions: Session[]): WorktreeGroup[] {
  const map = new Map<string, Session[]>();
  for (const s of sessions) {
    if (!s.worktree) continue;
    if (!map.has(s.worktree)) map.set(s.worktree, []);
    map.get(s.worktree)!.push(s);
  }
  return Array.from(map.entries()).map(([branch, sessions]) => ({
    branch,
    sessions,
  }));
}

export function WorktreePanel({ sessions }: { sessions: Session[] }) {
  const [open, setOpen] = useState(false);
  const groups = groupByWorktree(sessions);

  if (groups.length === 0) return null;

  return (
    <div className="border-b border-border">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/50 @sm:px-4"
      >
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          size={12}
          className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <HugeiconsIcon icon={GitBranchIcon} size={12} className="shrink-0" />
        <span className="font-medium">
          worktrees
        </span>
        <Badge size="small" color="blue">
          {groups.length}
        </Badge>
      </button>

      {open && (
        <Stack gap={0} px={3} pb={2} className="@sm:px-4">
          {groups.map(({ branch, sessions }) => (
            <div key={branch} className="py-1.5">
              <Group gap={2} ay="center">
                <Text size={-1} weight="bold" className="font-mono">
                  {branch}
                </Text>
                <Text size={-1} shade="muted">
                  {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
                </Text>
              </Group>
              <Stack gap={0} className="mt-1">
                {sessions.map((s) => {
                  const { session: name } = parseSessionName(s.session);
                  return (
                    <Group key={s.session} gap={2} ay="center" className="py-0.5 pl-2">
                      <StatusDot status={s.status} />
                      <Text size={-1}>{name}</Text>
                      <Text size={-1} shade="muted">{s.status}</Text>
                    </Group>
                  );
                })}
              </Stack>
            </div>
          ))}
        </Stack>
      )}
    </div>
  );
}
