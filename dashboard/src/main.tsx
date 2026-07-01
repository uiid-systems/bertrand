import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider, createRouter } from "@tanstack/react-router"
import { Toaster, ToastProvider } from "@uiid/design-system"
import { routeTree } from "./routeTree.gen"
import { SelectedProjectsProvider } from "./components/sidebar/selected-projects"

// One-shot cleanup: earlier builds shipped a vite-plugin-pwa service worker
// that intercepts fetches and can serve stale/empty assets long after the
// plugin is gone. Unregister anything still installed so the next reload is
// clean. Safe to remove once every active user has loaded a post-cleanup build.
if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  void navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const reg of regs) void reg.unregister()
  })
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    },
  },
})

const router = createRouter({ routeTree })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SelectedProjectsProvider>
        <ToastProvider>
          <RouterProvider router={router} />
          <Toaster position="bottom" />
        </ToastProvider>
      </SelectedProjectsProvider>
    </QueryClientProvider>
  </StrictMode>
)
