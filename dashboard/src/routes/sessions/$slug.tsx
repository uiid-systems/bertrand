import { createFileRoute, Link } from "@tanstack/react-router";
import { type ReactNode, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { Breadcrumbs, Stack, Timeline } from "@uiid/design-system";

import { eventsQuery, sessionsQuery } from "../../api/queries";
import {
  eventColor,
  eventTitle,
  formatTimestamp,
} from "../../lib/format";
import { applyTransforms } from "../../lib/timeline/transforms";
import { EventContent } from "../../components/timeline";

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

  const { data: rawEvents = [] } = useQuery(eventsQuery(sessionId));
  const events = useMemo(() => applyTransforms(rawEvents), [rawEvents]);

  const breadcrumbs = match
    ? buildBreadcrumbs(match.groupPath, match.session.name)
    : [{ label: slug, value: "" }];

  return (
    <Stack ax="stretch" fullwidth style={{ overflow: "hidden" }}>
      <Stack bb={1} p={4}>
        <Breadcrumbs items={breadcrumbs} linkAs={RouterLink} />
      </Stack>
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
