import { Group, Stack } from "@uiid/layout";
import { Select } from "@uiid/forms";

import type { SessionStatus } from "@/lib/types";

import { SearchInput } from "./search-input";
import { FilterPopover } from "./filter-popover";

interface HeaderProps {
  projects: string[];
  selectedProject: string | null;
  onProject: (project: string | null) => void;
  statusCounts: Record<SessionStatus, number>;
}

export function Header({
  projects,
  selectedProject,
  onProject,
  statusCounts,
}: HeaderProps) {
  return (
    <Stack data-slot="header" bb={1} fullwidth>
      <Group
        data-slot="header-top"
        ay="center"
        ax="space-between"
        p={2}
        fullwidth
      >
        <Select
          placeholder="Showing all projects"
          value={selectedProject}
          onValueChange={(val) => onProject(val || null)}
          items={projects.map((p) => ({ label: p, value: p }))}
          size="small"
        />
        <Group ay="center" gap={2}>
          <SearchInput />
          <FilterPopover counts={statusCounts} />
        </Group>
      </Group>
    </Stack>
  );
}
