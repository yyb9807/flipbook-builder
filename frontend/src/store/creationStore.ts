import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface CreationState {
  tab: 'text' | 'image'
  topic: string
  keywords: string
  generateImages: boolean
  file: File | null
  submittedOperationId: string | null
  setTab: (tab: 'text' | 'image') => void
  setTopic: (topic: string) => void
  setKeywords: (keywords: string) => void
  setGenerateImages: (generateImages: boolean) => void
  setFile: (file: File | null) => void
  clear: () => void
  markSubmitted: (operationId: string) => void
  clearSubmitted: (operationId: string) => void
}
export const useCreationStore = create<CreationState>()(persist((set) => ({
  tab: 'text', topic: '', keywords: '', generateImages: false, file: null, submittedOperationId: null,
  setTab: (tab) => set({ tab, submittedOperationId: null }), setTopic: (topic) => set({ topic, submittedOperationId: null }),
  setKeywords: (keywords) => set({ keywords, submittedOperationId: null }), setFile: (file) => set({ file, submittedOperationId: null }),
  setGenerateImages: (generateImages) => set({ generateImages, submittedOperationId: null }),
  clear: () => set({ topic: '', keywords: '', file: null, submittedOperationId: null }),
  markSubmitted: (operationId) => set({ submittedOperationId: operationId }),
  clearSubmitted: (operationId) => set((state) => state.submittedOperationId === operationId ? { topic: '', keywords: '', file: null, submittedOperationId: null } : {}),
}), { name: 'flipbook-creation', partialize: (s) => ({ tab: s.tab, topic: s.topic, keywords: s.keywords, generateImages: s.generateImages, submittedOperationId: s.submittedOperationId }) }))
