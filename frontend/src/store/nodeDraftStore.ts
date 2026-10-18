import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ContentMetadata, SceneDocument } from '../types'
import { useLibraryStore } from './libraryStore'

export interface NodeDraft { title: string; description: string; scene_document: SceneDocument | null; content_metadata?: ContentMetadata | null }
interface DraftState {
  drafts: Record<string, Record<string, NodeDraft>>
  setDraft: (projectId: string, nodeId: string, draft: NodeDraft) => void
  clearDraft: (projectId: string, nodeId: string) => void
  removeProject: (projectId: string) => void
}
export const useNodeDraftStore = create<DraftState>()(persist((set) => ({
  drafts: {},
  setDraft: (pid, nid, draft) => set((s) => ({ drafts: { ...s.drafts, [pid]: { ...s.drafts[pid], [nid]: draft } } })),
  clearDraft: (pid, nid) => set((s) => {
    const nodes = Object.fromEntries(Object.entries(s.drafts[pid] ?? {}).filter(([id]) => id !== nid))
    return { drafts: { ...s.drafts, [pid]: nodes } }
  }),
  removeProject: (pid) => set((s) => ({ drafts: Object.fromEntries(Object.entries(s.drafts).filter(([id]) => id !== pid)) })),
}), {
  name: 'flipbook-node-drafts', partialize: (s) => ({ drafts: s.drafts }),
  storage: {
    getItem: (name) => { try { const raw = localStorage.getItem(name); return raw ? JSON.parse(raw) : null } catch { return null } },
    setItem: (name, value) => { try { localStorage.setItem(name, JSON.stringify(value)) } catch { if (!useLibraryStore.getState().storageError) useLibraryStore.setState({ storageError: true }) } },
    removeItem: (name) => localStorage.removeItem(name),
  },
}))
