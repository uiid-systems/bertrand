import { create } from "zustand"

export type ViewMode = "by-status" | "by-ticket" | "most-recent"

interface SessionStore {
  /** Active project filter — derived from session names */
  selectedProject: string | null
  setSelectedProject: (project: string | null) => void

  /** Text filter for future search */
  searchQuery: string
  setSearchQuery: (query: string) => void

  /** Grouping preset for future view modes */
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
}

export const useSessionStore = create<SessionStore>()((set) => ({
  selectedProject: null,
  setSelectedProject: (project) => set({ selectedProject: project }),

  searchQuery: "",
  setSearchQuery: (query) => set({ searchQuery: query }),

  viewMode: "by-status",
  setViewMode: (mode) => set({ viewMode: mode }),
}))
