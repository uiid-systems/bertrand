import { useMemo } from "react";
import { Box, Text, useTui } from "@orchetron/storm";
import { existsSync } from "fs";

import { AppDetails, Logo } from "@/tui/components";
import { Picker, type PickerItem } from "@/tui/components/picker";
import {
  listProjects,
  getActiveProjectSlug,
  type ProjectEntry,
} from "@/lib/projects/registry";
import { projectPaths } from "@/lib/projects/paths";
import { getDbForProject } from "@/db/client";
import { sessions } from "@/db/schema";
import { formatAgo } from "@/lib/format";

import type { ProjectPickerSelection, ProjectPickerProps } from "./project-picker.types";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

interface ProjectStats {
  total: number;
  active: number;
  /** Set when the project's DB couldn't be opened (corrupt, perms, etc.) */
  unreadable: boolean;
}

function statsFor(slug: string): ProjectStats {
  const dbFile = projectPaths(slug).db;
  if (!existsSync(dbFile)) return { total: 0, active: 0, unreadable: false };
  try {
    const db = getDbForProject(slug);
    const all = db
      .select({ status: sessions.status })
      .from(sessions)
      .all();
    return {
      total: all.length,
      active: all.filter(
        (s) =>
          s.status === "active" ||
          s.status === "waiting" ||
          s.status === "blocked",
      ).length,
      unreadable: false,
    };
  } catch {
    return { total: 0, active: 0, unreadable: true };
  }
}

function projectRow(entry: ProjectEntry, isActive: boolean): PickerItem {
  const stats = statsFor(entry.slug);
  const sessionsLabel = stats.unreadable
    ? "?"
    : `${stats.active}/${stats.total}`;
  const lastUsed = formatAgo(entry.lastUsedAt);

  return {
    value: entry.slug,
    label: `${entry.slug} ${entry.name} ${sessionsLabel}`,
    meta: lastUsed,
    display: (isCursor: boolean) => {
      const cursorColor = "green";
      const slugColor = isCursor ? cursorColor : undefined;
      const nameColor = isCursor ? cursorColor : undefined;
      return (
        <>
          <Text color={cursorColor} bold>
            {isCursor ? "❯ " : "  "}
          </Text>
          <Text bold={isActive} color={isActive ? "gold" : slugColor}>
            {isActive ? "● " : "  "}
          </Text>
          <Text color={slugColor} bold={isCursor || isActive}>
            {entry.slug.padEnd(16)}
          </Text>
          <Text color={nameColor} dim={!isCursor}>
            {entry.name.padEnd(20)}
          </Text>
          <Text dim>
            {stats.unreadable ? " (unreadable)" : ` ${sessionsLabel} active/total`}
          </Text>
        </>
      );
    },
  };
}

export function ProjectPicker({ onSelect }: ProjectPickerProps) {
  const { exit } = useTui();

  const allProjects = useMemo(() => listProjects(), []);
  const activeSlug = useMemo(() => getActiveProjectSlug(), []);

  const items: PickerItem[] = useMemo(() => {
    return allProjects
      .slice()
      .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
      .map((p) => projectRow(p, p.slug === activeSlug));
  }, [allProjects, activeSlug]);

  const suggestions = useMemo(() => allProjects.map((p) => p.slug), [allProjects]);

  const knownSlugs = useMemo(
    () => new Set(allProjects.map((p) => p.slug)),
    [allProjects],
  );

  const select = (selection: ProjectPickerSelection) => {
    onSelect(selection);
    exit();
  };

  const handleSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    if (knownSlugs.has(trimmed)) {
      select({ type: "select", slug: trimmed });
      return;
    }

    // New project — validate slug shape before forwarding to the create flow.
    if (!SLUG_PATTERN.test(trimmed)) {
      return;
    }
    select({ type: "create", slug: trimmed });
  };

  return (
    <Box flexDirection="column" paddingY={1} gap={1}>
      <Box marginX={1}>
        <Logo />
      </Box>

      <Box flexDirection="column" marginX={2} gap={1}>
        <AppDetails />

        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" gap={1}>
            <Text bold>Projects</Text>
            {allProjects.length > 0 ? (
              <>
                <Text dim>·</Text>
                <Text dim>
                  {allProjects.length} total
                  {activeSlug ? ` · active: ${activeSlug}` : ""}
                </Text>
              </>
            ) : (
              <Text dim>· none — type a slug to create your first project</Text>
            )}
          </Box>

          <Picker
            mode="single"
            items={items}
            isFocused
            maxVisible={16}
            suggest={suggestions}
            placeholder="Filter or type a new slug to create…"
            emptyHint="No projects. Type a slug to create one."
            onSubmit={handleSubmit}
            onKey={(e) => {
              if (e.key === "c" && e.ctrl) {
                select({ type: "quit" });
              }
            }}
          />

          <Text dim>
            ↑↓ navigate · enter select · type to filter or create new · ctrl+c quit
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
