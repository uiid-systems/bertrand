import {
  createRootRoute,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";

import {
  Stack,
  Resizable,
  ResizablePanel,
  ResizableHandle,
} from "@uiid/design-system";

import { Sidebar } from "../components/sidebar";
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
        <Stack fullwidth style={{ flex: 1, overflow: "auto" }}>
          <Outlet />
        </Stack>
      </Stack>
    );
  }

  return <AppShell />;
}

function AppShell() {
  return (
    <Stack fullwidth style={{ position: "fixed", height: "100dvh" }}>
      <TopBar />
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
