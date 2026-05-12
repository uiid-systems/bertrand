import { createFileRoute, Link } from "@tanstack/react-router";
import { type ReactNode, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  Breadcrumbs,
  Button,
  Group,
  Sheet,
  Stack,
  Timeline,
} from "@uiid/design-system";
import { PanelRightIcon } from "@uiid/icons";

import { eventsQuery, sessionsQuery } from "../../api/queries";
import { eventColor, eventTitle, formatTimestamp } from "../../lib/format";
import { applyTransforms } from "../../lib/timeline/transforms";
import { EventContent } from "../../components/timeline";
import { SecondarySidebar } from "../../components/secondary-sidebar";

export const Route = createFileRoute("/sessions/$slug")({
  component: SessionDetail,
});

const RouterLink = ({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) => <Link to={href}>{children}</Link>;

type Crumb = { label: string; value: string };

function buildBreadcrumbs(groupPath: string, sessionName: string): Crumb[] {
  const segments = groupPath.split("/").filter(Boolean);
  const items: Crumb[] = segments.map((segment, i) => ({
    label: segment,
    value: `/groups/${segments.slice(0, i + 1).join("/")}`,
  }));
  items.push({ label: sessionName, value: "" });
  return items;
}

function SessionDetail() {
  const { slug } = Route.useParams();
  const { data: sessions = [] } = useQuery(sessionsQuery);
  const match = sessions.find((s) => s.session.slug === slug);
  const sessionId = match?.session.id ?? "";
  const isLive =
    match?.session.status === "active" || match?.session.status === "waiting";

  const { data: rawEvents = [] } = useQuery(eventsQuery(sessionId, isLive));
  const events = useMemo(() => applyTransforms(rawEvents), [rawEvents]);

  const breadcrumbs = match
    ? buildBreadcrumbs(match.groupPath, match.session.name)
    : [{ label: slug, value: "" }];

  return (
    <Stack ax="stretch" fullwidth style={{ overflow: "hidden" }}>
      <Group bb={1} px={4} py={2} ay="center" ax="space-between" fullwidth>
        <Breadcrumbs items={breadcrumbs} linkAs={RouterLink} />
        <Sheet
          side="right"
          title="Session stats"
          trigger={
            <Button
              tooltip="Session stats"
              variant="subtle"
              size="small"
              shape="square"
            >
              <PanelRightIcon />
            </Button>
          }
        >
          <SecondarySidebar />
        </Sheet>
      </Group>
      <Stack p={8} ax="stretch" fullwidth style={{ overflowY: "auto" }}>
        {events.length > 0 && (
          <Timeline
            activeIndex={events.length}
            items={events.map((e) => ({
              title: eventTitle(e),
              time: formatTimestamp(e.createdAt),
              color: eventColor(e.event),
              content: <EventContent event={e} />,
            }))}
            ItemProps={{ style: { width: "100%" } }}
            ContentProps={{ fullwidth: true }}
          />
        )}
      </Stack>
    </Stack>
  );
}
