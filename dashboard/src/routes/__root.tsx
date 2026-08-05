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
        {/* Reserve the scrollbar's space whether or not it's showing. A dev page
            that measures its own boxes (the terminal harness derives a character
            grid from one) must not have their width depend on how tall the page
            happens to be — otherwise content crossing the scroll threshold
            narrows the box, which changes the content, which uncrosses it. */}
        <Stack
          fullwidth
          style={{ flex: 1, overflow: "auto", scrollbarGutter: "stable" }}
        >
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
