import { Card, Stack } from "@uiid/design-system";

/**
 * Shared shell for every timeline item's content. Wrapping lives here in one
 * place so prompts, assistant messages, tool work, and lifecycle events all
 * render inside an identical, neutral card. Per-type distinction stays in the
 * timeline rail + icon (see `colorOf`/`iconOf` usage in the route), not on the
 * card surface itself.
 */
export function EventCard({ children }: Readonly<React.PropsWithChildren>) {
  return (
    <Stack data-slot="event-content" fullwidth>
      <Card p={3} gap={2} fullwidth>
        {children}
      </Card>
    </Stack>
  );
}
EventCard.displayName = "EventCard";
