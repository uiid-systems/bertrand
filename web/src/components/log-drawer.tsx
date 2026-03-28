import { useMemo, useRef, useEffect } from "react";

import { Group, Stack, Text } from "@uiid/design-system";

import { useSessionLog } from "@/hooks/useSessionLog";
import { SessionStats } from "@/components/session-stats";
import {
  TimelineSegmentView,
  buildSegments,
  extractRepoBase,
} from "@/components/timeline/timeline-event";
import { Separator } from "@/components/ui/separator";

/**
 * Format a date as a short label for day separators.
 * Today → "Today", Yesterday → "Yesterday", else → "Mar 20"
 */
function dayLabel(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = today.getTime() - target.getTime();
  if (diff === 0) return "Today";
  if (diff === 86400000) return "Yesterday";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function dayKey(ts: string): string {
  return new Date(ts).toDateString();
}

export function LogDrawer({ sessionName }: { sessionName: string }) {
  const { data: digest, isError } = useSessionLog(sessionName, true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const timeline = digest?.timeline ?? [];
  const segments = useMemo(
    () => buildSegments(timeline.slice(-50)),
    [timeline],
  );
  const repoBase = useMemo(() => extractRepoBase(timeline), [timeline]);

  // Auto-scroll to bottom when segments change
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [segments]);

  if (isError) {
    return (
      <div className="px-3 pb-2 pt-1 text-xs">
        <span className="text-destructive">failed to load log</span>
      </div>
    );
  }

  if (!digest || timeline.length === 0) {
    return (
      <div className="px-3 pb-2 pt-1 text-xs">
        <span className="text-muted-foreground">no log entries</span>
      </div>
    );
  }

  // Track which days we've seen to insert separators
  let lastDay = "";

  return (
    <Stack fullwidth>
      <SessionStats digest={digest} />
      <Separator />
      <Stack
        ref={scrollRef}
        className="max-h-[640px] overflow-y-auto"
        px={3}
        pb={2}
        pt={2}
        fullwidth
      >
        {segments.map((seg, i) => {
          const segDay = dayKey(seg.ts);
          const showSeparator = segDay !== lastDay && lastDay !== "";
          lastDay = segDay;

          return (
            <div key={`${seg.ts}-${seg.type}-${i}`}>
              {showSeparator && (
                <Group ay="center" gap={2} py={2} className="opacity-40">
                  <Text size={-1} shade="muted">
                    {dayLabel(new Date(seg.ts))}
                  </Text>
                </Group>
              )}
              <TimelineSegmentView segment={seg} repoBase={repoBase} />
            </div>
          );
        })}
      </Stack>
    </Stack>
  );
}
