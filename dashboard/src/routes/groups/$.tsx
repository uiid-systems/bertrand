import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { Breadcrumbs, Stack, Text } from "@uiid/design-system";

import { sessionsQuery } from "../../api/queries";
import { SessionItem } from "../../components/sidebar/session-item";

export const Route = createFileRoute("/groups/$")({
  component: GroupDetail,
});

const RouterLink = ({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) => <Link to={href}>{children}</Link>;

function GroupDetail() {
  const { _splat: groupPath } = Route.useParams();
  const { data: sessions = [] } = useQuery(sessionsQuery);

  const filtered = sessions.filter((s) => s.groupPath === groupPath);

  const segments = (groupPath ?? "").split("/").filter(Boolean);
  const breadcrumbs = segments.map((segment, i) => ({
    label: segment,
    value: `/groups/${segments.slice(0, i + 1).join("/")}`,
  }));

  return (
    <Stack gap={4} ax="stretch" fullwidth>
      <Stack
        bb={1}
        p={4}
        style={{
          position: "sticky",
          top: 0,
          backgroundColor: "var(--shade-background)",
          zIndex: 1,
        }}
      >
        <Breadcrumbs items={breadcrumbs} linkAs={RouterLink} />
      </Stack>
      <Stack px={8} gap={2} style={{ overflow: "auto" }}>
        {filtered.length > 0 ? (
          filtered.map((s) => (
            <SessionItem key={s.session.id} session={s} />
          ))
        ) : (
          <Text shade="muted">No sessions in this group.</Text>
        )}
      </Stack>
    </Stack>
  );
}
