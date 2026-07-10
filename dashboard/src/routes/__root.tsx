import {
  createRootRoute,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import {
  Stack,
  Resizable,
  ResizablePanel,
  ResizableHandle,
} from "@uiid/design-system";

import { sessionsQuery } from "../api/queries";
import { isLiveStatus } from "../lib/format";
import { useMatchedSession } from "../lib/use-matched-session";
import { Sidebar } from "../components/sidebar";
import { SecondarySidebar } from "../components/secondary-sidebar";
import { useSelectedProjects } from "../components/sidebar/selected-projects";
import { TopBar } from "../components/topbar";

import "../globals.css";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname.startsWith("/dev/")) {
    return (
      <Stack
        fullwidth
        style={{ position: "fixed", inset: 0, height: "100dvh" }}
      >
        <TopBar />
        <Stack
          render={<main />}
          fullwidth
          style={{ flex: 1, overflow: "auto" }}
        >
          <Outlet />
        </Stack>
      </Stack>
    );
  }

  return <AppShell />;
}

function AppShell() {
  const { queryProjects } = useSelectedProjects();
  const { data: sessions = [] } = useQuery(
    sessionsQuery({ projects: queryProjects }),
  );

  // Resolve the current route to a session so the secondary sidebar can render
  // as a sibling of <main> (mirroring the primary sidebar) rather than being
  // nested inside the route content. Non-session routes leave `match` null and
  // the panel simply doesn't mount.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const match = useMatchedSession(pathname);

  return (
    <Stack fullwidth style={{ position: "fixed", height: "100dvh" }}>
      <TopBar sessionCount={sessions.length} />
      <Resizable direction="horizontal">
        <ResizablePanel defaultSize={360} minSize={320} maxSize={540}>
          <Sidebar />
        </ResizablePanel>

        <ResizableHandle />
        <ResizablePanel>
          <Stack render={<main />} fullwidth fullheight>
            <Outlet />
          </Stack>
        </ResizablePanel>

        {match && (
          <>
            <ResizableHandle />
            <ResizablePanel defaultSize={420} minSize={360} maxSize={640}>
              <SecondarySidebar
                sessionId={match.session.id}
                isLive={isLiveStatus(match.session.status)}
                projectSlug={match.project?.slug}
              />
            </ResizablePanel>
          </>
        )}
      </Resizable>
    </Stack>
  );
}
