import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { TanStackRouterVite } from "@tanstack/router-plugin/vite"

export default defineConfig({
  plugins: [TanStackRouterVite(), react()],
  server: {
    port: 5199,
    proxy: {
      "/api": {
        target: "http://localhost:5200",
        changeOrigin: true,
      },
    },
  },
})
