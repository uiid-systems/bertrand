import { useMemo, useState } from "react";
import { Box, Text, useTui } from "@orchetron/storm";

import { AppDetails, Logo } from "@/tui/components";
import { Picker, type PickerItem } from "@/tui/components/picker";
import { getAllSessions } from "@/db/queries/sessions";
import { archiveSession, unarchiveSession } from "@/lib/session-archive";
import { formatAgo } from "@/lib/format";
import { parseSessionName } from "@/lib/parse-session-name";

import type { LaunchSelection, LaunchProps } from "./launch.types";

type SessionRow = ReturnType<typeof getAllSessions>[number];

const STATUS_COLOR: Record<string, string> = {
  paused: "gold",
  waiting: "red",
  archived: "purple",
};

const STATUS_RANK: Record<string, number> = {
  paused: 0,
  waiting: 1,
  archived: 2,
};

function statusRank(status: string): number {
  return STATUS_RANK[status] ?? 99;
}

function recencyKey(s: SessionRow): string {
  return s.session.endedAt ?? s.session.startedAt;
}

function sessionRow(s: SessionRow): PickerItem {
  const status = s.session.status;
  const color = STATUS_COLOR[status] ?? "gray";
  const disabled = status === "waiting";
  const isArchived = status === "archived";

  return {
    value: `${s.groupPath}/${s.session.slug}`,
    label: `${s.groupPath}/${s.session.slug} ${status}`,
    meta: formatAgo(recencyKey(s)),
    disabled,
    dim: isArchived,
    display: (isCursor: boolean) => {
      const cursorColor = "green";
      const dotColor = isCursor ? cursorColor : color;
      const textColor = isCursor ? cursorColor : color;
      const slugColor = isCursor ? cursorColor : undefined;
      const dimText = !isCursor && (disabled || isArchived);
      return (
        <>
          <Text color={cursorColor} bold>
            {isCursor ? "❯ " : "  "}
          </Text>
          <Text color={dotColor} bold={isCursor}>
            ●{" "}
          </Text>
          <Text color={textColor} bold={isCursor} dim={dimText}>
            {status.padEnd(8)}
          </Text>
          <Text color={slugColor}> </Text>
          <Text color={slugColor} bold={isCursor} dim={dimText}>
            {s.session.slug}
          </Text>
        </>
      );
    },
  };
}

function groupHeader(groupPath: string): PickerItem {
  return {
    value: `__group:${groupPath}`,
    label: groupPath,
    kind: "header",
  };
}

export function Launch({ onSelect }: LaunchProps) {
  const { exit } = useTui();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const allSessions = useMemo(
    () => getAllSessions({ excludeArchived: !showArchived }),
    [showArchived, refreshKey],
  );

  const visibleSessions = useMemo(() => {
    return allSessions
      .filter((s) => {
        const st = s.session.status;
        if (st === "paused" || st === "waiting") return true;
        if (st === "archived") return showArchived;
        return false;
      })
      .sort((a, b) => {
        const g = a.groupPath.localeCompare(b.groupPath);
        if (g !== 0) return g;
        const r = statusRank(a.session.status) - statusRank(b.session.status);
        if (r !== 0) return r;
        return recencyKey(b).localeCompare(recencyKey(a));
      });
  }, [allSessions, showArchived]);

  const items: PickerItem[] = useMemo(() => {
    const rows: PickerItem[] = [];
    let lastGroup: string | null = null;
    for (const s of visibleSessions) {
      if (s.groupPath !== lastGroup) {
        rows.push(groupHeader(s.groupPath));
        lastGroup = s.groupPath;
      }
      rows.push(sessionRow(s));
    }
    return rows;
  }, [visibleSessions]);

  // Match against *all* loaded sessions so typing an existing name —
  // even one we don't render (active, waiting) — gets a clear message instead
  // of silently attempting a duplicate create.
  const sessionByValue = useMemo(() => {
    const map = new Map<string, SessionRow>();
    for (const s of allSessions) {
      map.set(`${s.groupPath}/${s.session.slug}`, s);
    }
    return map;
  }, [allSessions]);

  const handleArchiveKey = (cursorItem: PickerItem | null) => {
    if (!cursorItem) return;
    const existing = sessionByValue.get(cursorItem.value);
    if (!existing) return;

    setError(null);
    if (existing.session.status === "archived") {
      const result = unarchiveSession(existing.session.id);
      if (result.ok) {
        setNotice(`Unarchived ${cursorItem.value}`);
        setRefreshKey((k) => k + 1);
      } else {
        setError(`Couldn't unarchive: ${result.reason}`);
      }
      return;
    }

    const result = archiveSession(existing.session.id);
    if (result.ok) {
      setNotice(`Archived ${cursorItem.value}`);
      setRefreshKey((k) => k + 1);
    } else {
      setError(`Couldn't archive: ${result.reason}`);
    }
  };

  const select = (selection: LaunchSelection) => {
    onSelect(selection);
    exit();
  };

  const handleSubmit = (value: string) => {
    const existing = sessionByValue.get(value);
    if (existing) {
      if (existing.session.status === "paused") {
        select({ type: "pick", sessionId: existing.session.id });
        return;
      }
      setError(
        `${value} is ${existing.session.status} — can't resume from here.`,
      );
      return;
    }

    try {
      const { groupPath, slug } = parseSessionName(value);
      select({ type: "create", groupPath, slug });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid name");
    }
  };

  const counts = useMemo(() => {
    let paused = 0;
    let waiting = 0;
    let archived = 0;
    for (const s of visibleSessions) {
      if (s.session.status === "paused") paused++;
      else if (s.session.status === "waiting") waiting++;
      else if (s.session.status === "archived") archived++;
    }
    return { paused, waiting, archived };
  }, [visibleSessions]);

  return (
    <Box flexDirection="column" paddingY={1} gap={1}>
      <Box marginX={1}>
        <Logo />
      </Box>

      <Box flexDirection="column" marginX={2} gap={1}>
        <AppDetails />

        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" gap={1}>
            <Text bold>Sessions</Text>
            {visibleSessions.length === 0 ? (
              <Text dim>· none — type group/slug to create</Text>
            ) : (
              <>
                <Text dim>·</Text>
                <Text color="gold">{counts.paused} paused</Text>
                {counts.waiting > 0 && (
                  <>
                    <Text dim>·</Text>
                    <Text color="red" dim>
                      {counts.waiting} waiting
                    </Text>
                  </>
                )}
                {showArchived && counts.archived > 0 && (
                  <>
                    <Text dim>·</Text>
                    <Text color="purple" dim>
                      {counts.archived} archived
                    </Text>
                  </>
                )}
              </>
            )}
          </Box>

          <Picker
            mode="single"
            items={items}
            isFocused
            maxVisible={24}
            placeholder="Filter or type group/slug to create…"
            emptyHint={
              showArchived
                ? "No sessions. Type group/slug to create one."
                : "No paused sessions. Type group/slug to create one."
            }
            onSubmit={handleSubmit}
            onKey={(e, cursorItem) => {
              if (e.key === "c" && e.ctrl) {
                select({ type: "quit" });
              } else if (e.key === "a" && e.ctrl) {
                handleArchiveKey(cursorItem);
              } else if (e.key === "tab") {
                setError(null);
                setNotice(null);
                setShowArchived((v) => !v);
              }
            }}
          />

          {notice && <Text color="green">{notice}</Text>}
          {error && <Text color="red">{error}</Text>}

          <Text dim>
            ↑↓ navigate · enter continue/create · ctrl+a{" "}
            {showArchived ? "(un)archive" : "archive"} · tab{" "}
            {showArchived ? "hide" : "show"} archived · ctrl+c quit
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
