import { createRootRoute, Outlet } from "@tanstack/react-router"

export const Route = createRootRoute({
  component: () => (
    <div style={{ fontFamily: "monospace", padding: 24 }}>
      <h1 style={{ fontSize: 16, marginBottom: 16 }}>bertrand</h1>
      <Outlet />
    </div>
  ),
})
