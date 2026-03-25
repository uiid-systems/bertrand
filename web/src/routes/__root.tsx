import { createRootRoute, Outlet } from "@tanstack/react-router";
import { Stack } from "@uiid/layout";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <Stack
      data-slot="root"
      render={<main />}
      className="@container"
      ax="stretch"
      fullwidth
    >
      <Outlet />
    </Stack>
  );
}
