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
import { Sidebar } from "../components/sidebar";
import { useSelectedProjects } from "../components/sidebar/selected-projects";
import { TopBar } from "../components/topbar";
import { useSessionNotifications } from "../lib/use-session-notifications";

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
        <Stack fullwidth style={{ flex: 1, overflow: "auto" }}>
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

  // Fire browser notifications when any session (across all projects) crosses
  // into waiting/blocked. Self-contained — runs its own global query.
  useSessionNotifications();

  // The secondary sidebar lives inside the session route (see routes/$.tsx),
  // nested beside <main> beneath a shared breadcrumb bar. Here the shell only
  // owns the primary sidebar / main split.
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
      </Resizable>
    </Stack>
  );
}
