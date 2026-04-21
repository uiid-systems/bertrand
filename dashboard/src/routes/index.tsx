import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/")({
  component: () => (
    <div style={{ opacity: 0.5, fontSize: 13 }}>Select a session</div>
  ),
})
