import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Project } from '../types'

export interface LocalEntry { project: Project; updatedAt: string }
interface LibraryState {
  projects: Record<string, LocalEntry>
  storageError: boolean
  save: (project: Project) => void
  remove: (id: string) => void
}

export const useLibraryStore = create<LibraryState>()(persist((set) => ({
  projects: {}, storageError: false,
  save: (project) => set((s) => ({ projects: { ...s.projects, [project.project_id]: { project, updatedAt: new Date().toISOString() } } })),
  remove: (id) => set((s) => ({ projects: Object.fromEntries(Object.entries(s.projects).filter(([key]) => key !== id)) })),
}), {
  name: 'flipbook-library',
  partialize: (s) => ({ projects: s.projects }),
  storage: {
    getItem: (name) => { try { const raw = localStorage.getItem(name); return raw ? JSON.parse(raw) : null } catch { return null } },
    setItem: (name, value) => {
      try { localStorage.setItem(name, JSON.stringify(value)) } catch {
        queueMicrotask(() => { if (!useLibraryStore.getState().storageError) useLibraryStore.setState({ storageError: true }) })
      }
    },
    removeItem: (name) => localStorage.removeItem(name),
  },
}))
