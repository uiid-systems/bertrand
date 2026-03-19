import { create } from "zustand"

interface SessionStore {
  /** Active project filter — derived from session names */
  selectedProject: string | null
  setSelectedProject: (project: string | null) => void
}

export const useSessionStore = create<SessionStore>()((set) => ({
  selectedProject: null,
  setSelectedProject: (project) => set({ selectedProject: project }),
}))
