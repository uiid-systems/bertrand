import { createRootRoute, Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import {
  Stack,
  Resizable,
  ResizablePanel,
  ResizableHandle,
} from "@uiid/design-system";

import { sessionsQuery } from "../api/queries";
import { SecondarySidebarProvider } from "../lib/secondary-sidebar-context";

import { Sidebar } from "../components/sidebar";
import { TopBar } from "../components/topbar";
import { SecondarySidebar } from "../components/secondary-sidebar";

import "../globals.css";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const { data: sessions = [] } = useQuery(sessionsQuery);

  return (
    <SecondarySidebarProvider>
      <Stack fullwidth style={{ position: "fixed", height: "100dvh" }}>
        <TopBar sessionCount={sessions.length} />
        <Resizable direction="horizontal">
          <ResizablePanel defaultSize={360} minSize={320} maxSize={540}>
            <Sidebar sessions={sessions} />
          </ResizablePanel>

          <ResizableHandle />
          <ResizablePanel>
            <Stack render={<main />} fullwidth fullheight>
              <Outlet />
            </Stack>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize={460} minSize={380} maxSize={540}>
            <SecondarySidebar />
          </ResizablePanel>
        </Resizable>
      </Stack>
    </SecondarySidebarProvider>
  );
}
