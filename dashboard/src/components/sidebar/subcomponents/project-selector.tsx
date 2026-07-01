import { SelectMultiple } from "@uiid/design-system";

import { useSelectedProjects } from "../selected-projects";

/**
 * Multi-select project filter for the sidebar header. Purely a view control:
 * choosing projects changes which sessions the dashboard lists, never the CLI's
 * active project. Disabled when there's only one project (nothing to filter).
 */
export const ProjectSelector = () => {
  const { projects, selected, setSelected } = useSelectedProjects();

  if (projects.length === 0) return null;

  const items = projects.map((p) => ({ value: p.slug, label: p.name }));
  // `selected` is null only until the active-project default seeds (one tick);
  // the trigger shows its placeholder in that window.
  const value = selected ?? [];

  return (
    <SelectMultiple
      size="small"
      fullwidth
      items={items}
      value={value}
      onValueChange={(next) => setSelected(next)}
      disabled={projects.length <= 1}
      placeholder="Select projects"
    />
  );
};
ProjectSelector.displayName = "ProjectSelector";
