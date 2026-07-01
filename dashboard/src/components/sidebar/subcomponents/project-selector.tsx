import { Button, Group, SelectMultiple } from "@uiid/design-system";
import { ActivityIcon } from "@uiid/icons";

import { useSelectedProjects } from "../selected-projects";

/**
 * Multi-select project filter for the sidebar header. Purely a view control:
 * choosing projects changes which sessions the dashboard lists, never the CLI's
 * active project. Disabled when there's only one project (nothing to filter).
 * The activity button snaps the view back to the live-projects default.
 */
export const ProjectSelector = () => {
  const { projects, selected, setSelected, resetToLive, isAtLiveDefault } =
    useSelectedProjects();

  if (projects.length === 0) return null;

  const items = projects.map((p) => ({ value: p.slug, label: p.name }));
  // `selected` is null only until the live default seeds (one tick); the
  // trigger shows its placeholder in that window.
  const value = selected ?? [];
  const multiple = projects.length > 1;

  return (
    <Group ay="center" gap={1} fullwidth>
      <div style={{ flex: 1, minWidth: 0 }}>
        <SelectMultiple
          size="small"
          fullwidth
          items={items}
          value={value}
          onValueChange={(next) => setSelected(next)}
          disabled={!multiple}
          placeholder="Select projects"
        />
      </div>
      {multiple && (
        <Button
          tooltip="Show live projects"
          aria-label="Show live projects"
          variant="subtle"
          size="small"
          shape="square"
          disabled={isAtLiveDefault}
          onClick={resetToLive}
        >
          <ActivityIcon />
        </Button>
      )}
    </Group>
  );
};
ProjectSelector.displayName = "ProjectSelector";
