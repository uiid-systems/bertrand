import { FilterHorizontalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@uiid/buttons";
import { Group, Stack } from "@uiid/layout";
import { Popover } from "@uiid/overlays";
import { Text } from "@uiid/typography";

import { useSessionStore, type ViewMode } from "@/store/session-store";
import type { SessionStatus } from "@/lib/types";

const VIEWS: { mode: ViewMode; label: string }[] = [
  { mode: "status", label: "by status" },
  { mode: "ticket", label: "by ticket" },
  { mode: "recent", label: "recent" },
];

const STATUSES: { status: SessionStatus; label: string }[] = [
  { status: "working", label: "working" },
  { status: "blocked", label: "blocked" },
  { status: "prompting", label: "prompting" },
  { status: "paused", label: "paused" },
  { status: "archived", label: "archived" },
];

const chipColors: Record<SessionStatus, { active: string; inactive: string }> =
  {
    working: {
      active:
        "bg-[var(--status-working)]/15 text-[var(--status-working)] ring-1 ring-[var(--status-working)]/30",
      inactive: "text-muted-foreground hover:text-[var(--status-working)]",
    },
    blocked: {
      active:
        "bg-[var(--status-blocked)]/15 text-[var(--status-blocked)] ring-1 ring-[var(--status-blocked)]/30",
      inactive: "text-muted-foreground hover:text-[var(--status-blocked)]",
    },
    prompting: {
      active:
        "bg-[var(--status-prompting)]/15 text-[var(--status-prompting)] ring-1 ring-[var(--status-prompting)]/30",
      inactive: "text-muted-foreground hover:text-[var(--status-prompting)]",
    },
    paused: {
      active:
        "bg-muted-foreground/15 text-muted-foreground ring-1 ring-muted-foreground/30",
      inactive: "text-muted-foreground/60 hover:text-muted-foreground",
    },
    archived: {
      active:
        "bg-muted-foreground/10 text-muted-foreground/80 ring-1 ring-muted-foreground/20",
      inactive: "text-muted-foreground/40 hover:text-muted-foreground/60",
    },
  };

export function FilterPopover({
  counts,
}: {
  counts: Record<SessionStatus, number>;
}) {
  const viewMode = useSessionStore((s) => s.viewMode);
  const setViewMode = useSessionStore((s) => s.setViewMode);
  const statusFilters = useSessionStore((s) => s.statusFilters);
  const toggleStatusFilter = useSessionStore((s) => s.toggleStatusFilter);
  const clearStatusFilters = useSessionStore((s) => s.clearStatusFilters);

  const activeCount = statusFilters.size;

  return (
    <Popover
      trigger={
        <Button variant="ghost" size="xsmall" tooltip="Filter">
          <HugeiconsIcon icon={FilterHorizontalIcon} size={14} />
        </Button>
      }
    >
      <Stack gap={3}>
        <Stack gap={2}>
          <Text weight="bold" size={-1}>
            View
          </Text>
          <Group gap={1}>
            {VIEWS.map(({ mode, label }) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`rounded px-2 py-1 text-xs transition-colors ${
                  viewMode === mode
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </Group>
        </Stack>

        <Stack gap={1}>
          <Group ax="space-between" ay="center">
            <Text shade="muted">Status</Text>
            {activeCount > 0 && (
              <button
                onClick={clearStatusFilters}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                clear
              </button>
            )}
          </Group>
          <Group gap={1}>
            {STATUSES.map(({ status, label }) => {
              const isActive = statusFilters.has(status);
              const colors = chipColors[status];
              const count = counts[status];

              return (
                <button
                  key={status}
                  onClick={() => toggleStatusFilter(status)}
                  className={`rounded px-2 py-1 text-xs transition-colors ${
                    isActive ? colors.active : colors.inactive
                  }`}
                >
                  {label}
                  {count > 0 && (
                    <span className="ml-1 text-[10px] opacity-60">{count}</span>
                  )}
                </button>
              );
            })}
          </Group>
        </Stack>
      </Stack>
    </Popover>
  );
}
