import { Kbd, Select } from "@uiid/design-system";
import {
  FolderIcon,
  GithubIcon,
  TriangleAlertIcon,
  Unlink2Icon,
} from "@uiid/icons";

import { useSelectedProject } from "../selected-project";

/**
 * The sidebar's project switcher. Purely a view control: choosing a project
 * changes which sessions the dashboard lists, never the CLI's active project.
 * Disabled when there's only one project (nothing to switch to).
 */
export const ProjectSelector = () => {
  const { projects, selected, setSelected } = useSelectedProject();

  if (projects.length === 0) return null;

  // Every option carries a second line: the bound `owner/repo`, or an explicit
  // "Not linked". Unbound projects get words rather than blank space, so the
  // gap reads as a state you can act on instead of a rendering bug.
  //
  // A binding whose host the CLI no longer vouches for keeps its label but
  // loses the GitHub mark: a host can be named to read like github.com, and
  // the one thing this row must not do is call it GitHub on that machine's say-so.
  const items = projects.map((p) => ({
    value: p.slug,
    label: p.name,
    description: p.repo
      ? p.repo.hostTrusted
        ? p.repo.label
        : `${p.repo.label} — unverified host`
      : "Not linked",
    icon: p.repo
      ? p.repo.hostTrusted
        ? GithubIcon
        : TriangleAlertIcon
      : Unlink2Icon,
  }));

  return (
    <Select
      data-slot="project-selector"
      placeholder="Select a project"
      // Base UI can emit `null` for a cleared select. There's no "no project"
      // view to fall back to, so a clear is simply ignored.
      onValueChange={(next) => {
        if (next !== null) setSelected(next);
      }}
      before={<FolderIcon />}
      // after={<Kbd hotkey={["meta", "j"]} />}
      disabled={projects.length < 2}
      items={items}
      value={selected}
      size="small"
      fullwidth
      TriggerProps={{ style: { minWidth: 0 } }}
    />
  );
};
ProjectSelector.displayName = "ProjectSelector";
