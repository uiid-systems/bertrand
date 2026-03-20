import { Group, Stack } from "@uiid/layout";

import { SearchInput } from "@/components/search-input";
import { StatusChips } from "@/components/status-chips";
import { ViewSwitcher } from "@/components/view-switcher";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "@/components/ui/select";
import type { SessionStatus } from "@/lib/types";

export function Header({
  projects,
  selectedProject,
  onProject,
  statusCounts,
}: {
  projects: string[];
  selectedProject: string | null;
  onProject: (project: string | null) => void;
  statusCounts: Record<SessionStatus, number>;
}) {
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
          value={selectedProject ?? ""}
          onValueChange={(val) => onProject(val || null)}
        >
          <SelectTrigger
            size="sm"
            className="min-w-0 w-auto border-none shadow-none bg-transparent font-semibold text-sm"
          >
            <SelectValue placeholder="project" />
          </SelectTrigger>
          <SelectPopup>
            {projects.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <SearchInput />
      </Group>

      <Group data-slot="header-bottom" ay="center" gap={2} p={2} fullwidth>
        <StatusChips counts={statusCounts} />
        <ViewSwitcher />
      </Group>
    </Stack>
  );
}
