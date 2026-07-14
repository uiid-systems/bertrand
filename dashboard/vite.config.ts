import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { TanStackRouterVite } from "@tanstack/router-plugin/vite"

export default defineConfig({
  plugins: [TanStackRouterVite(), react()],
  server: {
    port: 5199,
    proxy: {
      "/api": {
        // Worktree previews boot the branch's API sidecar on its own port and
        // point the SPA at it via BERTRAND_API_TARGET; without one, the proxy
        // hits the shared session server on :5200.
        target: process.env.BERTRAND_API_TARGET ?? "http://localhost:5200",
        changeOrigin: true,
      },
    },
  },
})
