import { Card, Stack } from "@uiid/design-system";

type EventCardProps = React.PropsWithChildren<{
  /**
   * Tighter padding + less vertical rhythm, for low-content events (e.g.
   * lifecycle markers that hold only a badge or two) so the card doesn't feel
   * oversized around a sliver of content.
   */
  compact?: boolean;
}>;

/**
 * Shared shell for every timeline item's content. Wrapping lives here in one
 * place so prompts, assistant messages, tool work, and lifecycle events all
 * render inside an identical, neutral card. Per-type distinction stays in the
 * timeline rail + icon (see `colorOf`/`iconOf` usage in the route), not on the
 * card surface itself.
 */
export function EventCard({ compact = true, children }: EventCardProps) {
  return (
    <Stack data-slot="event-content" py={4} fullwidth>
      <Card p={3} gap={2} fullwidth>
        {children}
      </Card>
    </Stack>
  );
}
EventCard.displayName = "EventCard";
