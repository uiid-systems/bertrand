import { Group, Stack, Text, type GroupProps } from "@uiid/design-system";
import { ChevronDownIcon, ChevronRightIcon } from "@uiid/icons";

/** Height of a zone's trigger bar — the full height of a collapsed zone. */
export const CONTENT_ZONE_HEADER_PX = 48;

export type ContentZoneProps = React.PropsWithChildren<{
  title: string;
  /** Rendered right after the title (e.g. a count or status Badge). */
  badge?: React.ReactNode;
  /** Pinned to the right edge of the trigger bar (e.g. a maximize button). */
  actions?: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Keep the body mounted while collapsed, hidden with `display: none`, instead
   * of unmounting it. Set this when mounting the body is expensive enough to be
   * felt — the timeline re-parses markdown for every event it holds, so
   * rebuilding it on each expand costs a visible pause on a long session.
   */
  keepMounted?: boolean;
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
 *   - the zone is itself a **flex item**, sized by `flex` rather than by its
 *     content, so a column of these divides the height between them: the open
 *     zone absorbs everything its collapsed siblings gave up, with no measuring
 *     or imperative resizing involved. Collapse them all and the column is just
 *     its stack of trigger bars.
 *
 * By default children are only rendered while open, so a collapsed zone holds no
 * live resources — a collapsed terminal detaches from its session rather than
 * sitting on an idle websocket. Bodies that are expensive to build rather than
 * expensive to keep should opt into `keepMounted` instead.
 */
export const ContentZone = ({
  title,
  badge,
  actions,
  open,
  onOpenChange,
  keepMounted,
  "data-slot": dataSlot,
  TriggerGroupProps,
  children,
}: ContentZoneProps) => (
  <Stack
    data-slot={dataSlot}
    data-open={open ? "" : undefined}
    ax="stretch"
    fullwidth
    bb={1}
    style={{
      // `1 1 0` rather than `1 1 auto` so an open zone's size comes from the
      // column, not from how tall its content happens to be — a timeline of 200
      // events must not push the terminal off the bottom.
      flex: open ? "1 1 0" : "0 0 auto",
      minHeight: 0,
      overflow: "hidden",
    }}
  >
    <Group
      className="content-zone-trigger"
      ay="center"
      gap={2}
      px={3}
      py={2}
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

    {(open || keepMounted) && (
      <Stack
        ax="stretch"
        fullwidth
        style={{
          flex: 1,
          minHeight: 0,
          // A kept-mounted body is taken out of layout rather than unmounted, so
          // reopening the zone costs a repaint instead of a full rebuild.
          display: open ? undefined : "none",
        }}
      >
        {children}
      </Stack>
    )}
  </Stack>
);
ContentZone.displayName = "ContentZone";
