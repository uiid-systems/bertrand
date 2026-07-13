import {
  Button,
  Group,
  Kbd,
  type GroupProps,
  SelectMultiple,
} from "@uiid/design-system";
import { ActivityIcon, FolderIcon } from "@uiid/icons";

import { useSelectedProjects } from "../selected-projects";

/**
 * Multi-select project filter for the sidebar header. Purely a view control:
 * choosing projects changes which sessions the dashboard lists, never the CLI's
 * active project. Disabled when there's only one project (nothing to filter).
 * The activity button snaps the view back to the live-projects default.
 */
export const ProjectSelector = ({ ...props }: GroupProps) => {
  const { projects, selected, setSelected, resetToLive, isAtLiveDefault } =
    useSelectedProjects();

  if (projects.length === 0) return null;

  const items = projects.map((p) => ({ value: p.slug, label: p.name }));
  // `selected` is null only until the live default seeds (one tick); the
  // trigger shows its placeholder in that window.
  const value = selected ?? [];
  const multiple = projects.length > 1;

  return (
    <Group ay="center" gap={1} fullwidth {...props}>
      <SelectMultiple
        placeholder="Select projects"
        items={items}
        value={value}
        onValueChange={(next) => setSelected(next)}
        before={<FolderIcon />}
        after={<Kbd hotkey={["meta", "j"]} />}
        size="small"
        disabled={!multiple}
        fullwidth
      />
      {multiple && (
        <Button
          tooltip="Show live projects"
          onClick={resetToLive}
          disabled={isAtLiveDefault}
          variant="subtle"
          size="small"
        >
          <ActivityIcon />
        </Button>
      )}
    </Group>
  );
};
ProjectSelector.displayName = "ProjectSelector";
