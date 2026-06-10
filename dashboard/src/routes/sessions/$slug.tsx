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
import { useArchiveAction } from "../../api/use-archive-action";
import type { SessionRow } from "../../api/types";
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
  // Look in both the default (non-archived) and archived-included lists so the
  // detail page resolves an archived session that was opened via deep link or
  // after toggling "show archived" off.
  const { data: visibleSessions = [] } = useQuery(sessionsQuery());
  const { data: allSessions = [] } = useQuery(
    sessionsQuery({ includeArchived: true }),
  );
  const match =
    visibleSessions.find((s) => s.session.slug === slug) ??
    allSessions.find((s) => s.session.slug === slug);
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
        <Group ay="center" gap={2}>
          {match && <ArchiveToggle session={match.session} />}
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
            ContentProps={{ fullwidth: true, maxw: 860 }}
          />
        )}
      </Stack>
    </Stack>
  );
}

function ArchiveToggle({ session }: { session: SessionRow }) {
  const action = useArchiveAction(session);
  const { Icon } = action;
  return (
    <Button
      tooltip={action.tooltip}
      variant="subtle"
      size="small"
      shape="square"
      disabled={action.disabled}
      loading={action.loading}
      onClick={action.onClick}
      aria-label={action.label}
    >
      <Icon />
    </Button>
  );
}
ArchiveToggle.displayName = "ArchiveToggle";
