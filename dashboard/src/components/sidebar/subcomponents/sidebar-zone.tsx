import { useState } from "react";

import {
  Collapsible,
  Group,
  Text,
  type CollapsiblePanelProps,
  type CollapsibleRootProps,
  type GroupProps,
} from "@uiid/design-system";
import { ChevronDownIcon, ChevronRightIcon } from "@uiid/icons";

export type SidebarZoneProps = React.PropsWithChildren<{
  title: string;
  /** Rendered after the title inside the trigger bar — pass `ml="auto"` on a
   * Badge to pin it to the right edge, matching the existing zones. */
  badge?: React.ReactNode;
  /** Controlled open state (persisted zones). Omit both to let the zone manage
   * itself, open by default. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  "data-slot"?: string;
  /** Zone-specific spacing lives with the caller, not here. */
  RootProps?: CollapsibleRootProps;
  PanelProps?: CollapsiblePanelProps;
  TriggerGroupProps?: GroupProps;
}>;

/**
 * The sidebar's collapsible section shell, shared by every zone ("Needs you",
 * per-project sections, "Worktree", "Files changed"): a full-width trigger
 * bar we own the styling of — chevron + bold title + optional badge, title
 * underlined on hover via `.sidebar-zone-trigger` — over an instant (no
 * animation) full-width panel. Supports controlled open state for zones that
 * persist collapses, and manages its own (open by default) otherwise.
 */
export const SidebarZone = ({
  title,
  badge,
  open: controlledOpen,
  onOpenChange,
  "data-slot": dataSlot,
  RootProps,
  PanelProps,
  TriggerGroupProps,
  children,
}: SidebarZoneProps) => {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(true);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;

  return (
    <Collapsible
      instant
      RootProps={{ open, onOpenChange: setOpen, ...RootProps }}
      TriggerProps={{ nativeButton: false }}
      PanelProps={{
        ...PanelProps,
        style: { width: "100%", ...PanelProps?.style },
      }}
      trigger={
        <Group
          data-slot={dataSlot}
          className="sidebar-zone-trigger"
          ay="center"
          gap={2}
          fullwidth
          style={{ cursor: "pointer" }}
          {...TriggerGroupProps}
        >
          {open ? (
            <ChevronDownIcon size={14} />
          ) : (
            <ChevronRightIcon size={14} />
          )}
          <Text className="sidebar-zone-title" weight="bold" size={0}>
            {title}
          </Text>
          {badge}
        </Group>
      }
    >
      {children}
    </Collapsible>
  );
};
SidebarZone.displayName = "SidebarZone";
