import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider, createRouter } from "@tanstack/react-router"
import { Toaster, ToastProvider } from "@uiid/design-system"
import { routeTree } from "./routeTree.gen"
import { SelectedProjectProvider } from "./components/sidebar/selected-project"

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
      <SelectedProjectProvider>
        <ToastProvider>
          <RouterProvider router={router} />
          <Toaster position="bottom" />
        </ToastProvider>
      </SelectedProjectProvider>
    </QueryClientProvider>
  </StrictMode>
)
