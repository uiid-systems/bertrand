import { create } from "zustand"
import type { SessionStatus } from "@/lib/types"

export type ViewMode = "status" | "ticket" | "recent"

interface SessionStore {
  /** Active project filter — derived from session names */
  selectedProject: string | null
  setSelectedProject: (project: string | null) => void

  /** Text search query — filters sessions by name and summary */
  searchQuery: string
  setSearchQuery: (query: string) => void

  /** Active status filters — empty means show all */
  statusFilters: Set<SessionStatus>
  toggleStatusFilter: (status: SessionStatus) => void
  clearStatusFilters: () => void

  /** View grouping preset */
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
}

export const useSessionStore = create<SessionStore>()((set) => ({
  selectedProject: null,
  setSelectedProject: (project) => set({ selectedProject: project }),

  searchQuery: "",
  setSearchQuery: (query) => set({ searchQuery: query }),

  statusFilters: new Set<SessionStatus>(),
  toggleStatusFilter: (status) =>
    set((state) => {
      const next = new Set(state.statusFilters)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return { statusFilters: next }
    }),
  clearStatusFilters: () => set({ statusFilters: new Set<SessionStatus>() }),

  viewMode: "status",
  setViewMode: (mode) => set({ viewMode: mode }),
}))
