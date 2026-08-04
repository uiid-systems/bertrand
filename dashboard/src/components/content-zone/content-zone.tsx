import { Group, Stack, Text, type GroupProps } from "@uiid/design-system";
import { ChevronDownIcon, ChevronRightIcon } from "@uiid/icons";

/**
 * Height of a zone's trigger bar. The main area's zones collapse by shrinking
 * their resizable panel down to exactly this, so the bar stays visible (and
 * clickable) instead of disappearing — which is why the number has to be shared
 * with the panel's `collapsedSize`.
 */
export const CONTENT_ZONE_HEADER_PX = 34;

export type ContentZoneProps = React.PropsWithChildren<{
  title: string;
  /** Rendered right after the title (e.g. a count or status Badge). */
  badge?: React.ReactNode;
  /** Pinned to the right edge of the trigger bar (e.g. a maximize button). */
  actions?: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  "data-slot"?: string;
  TriggerGroupProps?: GroupProps;
}>;

/**
 * A collapsible section of the main content area, the counterpart to
 * `SidebarZone` for the wider surfaces (timeline, terminal). It shares that
 * component's trigger anatomy — chevron, bold title, badge, right-aligned
 * actions, title underlined on hover — but differs in two ways that matter:
 *
 *   - the body **flexes** to fill the space rather than sizing to its content,
 *     because what goes in it (a terminal, a scrolling timeline) needs a real
 *     height to lay itself out against;
 *   - open state is **controlled by the caller**, because these zones collapse
 *     by shrinking a `ResizablePanel` — dragging the split closed and clicking
 *     the chevron have to end up in the same state.
 *
 * Children are only rendered while open, so a collapsed zone holds no live
 * resources (a collapsed terminal detaches from its session rather than sitting
 * on an idle websocket).
 */
export const ContentZone = ({
  title,
  badge,
  actions,
  open,
  onOpenChange,
  "data-slot": dataSlot,
  TriggerGroupProps,
  children,
}: ContentZoneProps) => (
  <Stack
    data-slot={dataSlot}
    ax="stretch"
    fullwidth
    fullheight
    style={{ minHeight: 0, overflow: "hidden" }}
  >
    <Group
      className="content-zone-trigger"
      ay="center"
      gap={2}
      px={3}
      bb={1}
      fullwidth
      onClick={() => onOpenChange(!open)}
      style={{
        height: CONTENT_ZONE_HEADER_PX,
        minHeight: CONTENT_ZONE_HEADER_PX,
        cursor: "pointer",
      }}
      {...TriggerGroupProps}
    >
      {open ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
      <Text className="content-zone-title" weight="bold" size={0}>
        {title}
      </Text>
      {badge}
      {/* Stop clicks in the action cluster from reaching the trigger, which
          would toggle the zone as a side effect of pressing a button. */}
      <Group ml="auto" gap={1} ay="center" onClick={(e) => e.stopPropagation()}>
        {actions}
      </Group>
    </Group>

    {open && (
      <Stack ax="stretch" fullwidth style={{ flex: 1, minHeight: 0 }}>
        {children}
      </Stack>
    )}
  </Stack>
);
ContentZone.displayName = "ContentZone";
