import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Group,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuRoot,
  MenuTrigger,
  Text,
} from "@uiid/design-system";
import { ChevronsUpDown } from "@uiid/icons";

import { projectsQuery, switchActiveProject } from "../../api/queries";

/**
 * Compact project switcher for the sidebar header. Shows the active
 * project name + a chevron; the menu lists every project and POSTs to
 * /api/active-project on click. The server exits on switch, so we wait
 * a short beat for the lifecycle daemon to respawn it before reloading.
 */
export const ProjectSwitcher = () => {
  const queryClient = useQueryClient();
  const { data: projects = [] } = useQuery(projectsQuery);
  const active = projects.find((p) => p.active);

  const handleSwitch = async (slug: string) => {
    if (active?.slug === slug) return;
    try {
      await switchActiveProject(slug);
    } catch (err) {
      // Surface as console error for now; the popover doesn't host a
      // status surface yet and a toast would be a heavier dependency.
      console.error("Project switch failed:", err);
      return;
    }
    // Invalidate the queries so the post-respawn fetch is fresh. Give
    // the server ~600ms to come back; ensureServerStarted spawns
    // detached and the port probe is ~500ms in the worst case.
    setTimeout(() => {
      queryClient.invalidateQueries();
      window.location.reload();
    }, 600);
  };

  if (projects.length === 0) {
    return null;
  }

  if (projects.length === 1) {
    // Single project — render a non-interactive label rather than a
    // menu trigger so we don't suggest there's more to choose from.
    return (
      <Group ay="center" gap={2} px={2}>
        <Text size={-1} shade="muted">
          project
        </Text>
        <Text size={-1} weight="bold">
          {active?.name ?? projects[0]?.name ?? "default"}
        </Text>
      </Group>
    );
  }

  return (
    <MenuRoot>
      <MenuTrigger
        render={
          <Button variant="subtle" size="small" fullwidth>
            <Group ay="center" ax="space-between" gap={2} fullwidth>
              <Group ay="center" gap={2}>
                <Text size={-1} shade="muted">
                  project
                </Text>
                <Text size={-1} weight="bold">
                  {active?.name ?? "—"}
                </Text>
              </Group>
              <ChevronsUpDown size={14} />
            </Group>
          </Button>
        }
      />
      <MenuPortal>
        <MenuPositioner side="bottom" align="start">
          <MenuPopup>
            {projects.map((p) => (
              <MenuItem
                key={p.slug}
                onClick={() => {
                  void handleSwitch(p.slug);
                }}
              >
                <Group ay="center" gap={2}>
                  <Text size={-1} weight={p.active ? "bold" : "normal"}>
                    {p.name}
                  </Text>
                  {p.active && (
                    <Text size={-1} shade="muted">
                      (active)
                    </Text>
                  )}
                </Group>
              </MenuItem>
            ))}
          </MenuPopup>
        </MenuPositioner>
      </MenuPortal>
    </MenuRoot>
  );
};
ProjectSwitcher.displayName = "ProjectSwitcher";
