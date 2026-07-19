import { useState } from "react";

import {
  Collapsible,
  Group,
  Text,
  ToggleButton,
  type CollapsiblePanelProps,
  type CollapsibleRootProps,
  type GroupProps,
} from "@uiid/design-system";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  Flashlight,
  FlashlightOff,
} from "@uiid/icons";

export type SidebarZoneProps = React.PropsWithChildren<{
  title: string;
  /** Rendered immediately after the title inside the trigger bar (e.g. a count
   * Badge). */
  badge?: React.ReactNode;
  /** Rendered pinned to the right edge of the trigger bar (e.g. page up/down
   * buttons). */
  actions?: React.ReactNode;
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
  actions,
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

  // Per-zone dimming. Default lit (on) so the zone looks unchanged until the
  // reader deliberately turns its flashlight off.
  const [lit, setLit] = useState(true);

  return (
    <Collapsible
      instant
      RootProps={{ open, onOpenChange: setOpen, ...RootProps }}
      TriggerProps={{ nativeButton: false }}
      PanelProps={{
        ...PanelProps,
        className: [PanelProps?.className, !lit && "sidebar-zone-dimmed"]
          .filter(Boolean)
          .join(" "),
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
          {/* Right cluster: any zone-specific actions plus the flashlight
              dim toggle. Stop clicks here from reaching the collapsible
              trigger, which would otherwise toggle the zone open/closed. */}
          <Group
            ml="auto"
            gap={1}
            ay="center"
            onClick={(e) => e.stopPropagation()}
          >
            {actions}
            <ToggleButton
              pressed={lit}
              onPressedChange={setLit}
              size="xsmall"
              variant="ghost"
              shape="square"
              aria-label={lit ? "Dim this section" : "Brighten this section"}
              tooltip={lit ? "Dim" : "Brighten"}
              icon={{
                pressed: <Flashlight size={13} />,
                unpressed: <FlashlightOff size={13} />,
              }}
            />
          </Group>
        </Group>
      }
    >
      {children}
    </Collapsible>
  );
};
SidebarZone.displayName = "SidebarZone";
