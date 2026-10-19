import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Project, FlipNode, Hotspot, Keyword } from '../types'
import { useLibraryStore } from './libraryStore'

export interface GenProgress { step: number; pct: number; message: string }
export type ProjectOrigin = 'server' | 'local' | 'example'

interface ProjectState {
  project: Project | null
  origin: ProjectOrigin
  activeNodeId: string | null
  mode: 'builder' | 'viewer'
  navigationStack: string[]
  generating: boolean
  analyzing: boolean
  genProgress: GenProgress | null
  keywords: Keyword[]
  selectedKeywords: string[]
  setProject: (p: Project, origin?: ProjectOrigin, historyReason?: string) => boolean
  adoptCommittedProject: (p: Project) => void
  openProject: (p: Project, origin?: ProjectOrigin, mode?: 'builder' | 'viewer') => void
  resetProject: () => void
  updateNode: (id: string, update: Partial<FlipNode>, historyReason?: string) => boolean
  addNode: (node: FlipNode) => void
  updateHotspot: (id: string, hotspot: Hotspot) => void
  setActiveNode: (id: string) => void
  navigateInto: (id: string) => void
  navigateBack: () => void
  navigateTo: (id: string) => void
  setMode: (mode: 'builder' | 'viewer') => void
  setKeywords: (keywords: Keyword[]) => void
  toggleKeyword: (label: string) => void
  setGenerating: (value: boolean) => void
  setAnalyzing: (value: boolean) => void
  setGenProgress: (value: GenProgress | null) => void
  getActiveNode: () => FlipNode | null
}

interface PersistedShape {
  _projectId: string | null
  origin: ProjectOrigin
  activeNodeId: string | null
  navigationStack: string[]
  mode: 'builder' | 'viewer'
  selectedKeywords: string[]
  _exampleProject?: Project | null
}

let workspaceRevision = 0
export function getWorkspaceRevision() { return workspaceRevision }

function pathTo(project: Project, id: string): string[] {
  const path: string[] = []
  const visited = new Set<string>()
  let cursor: string | null = id
  while (cursor && project.nodes[cursor] && !visited.has(cursor)) {
    visited.add(cursor)
    path.unshift(cursor)
    cursor = project.nodes[cursor].parent_id
  }
  return path
}

function saveLocal(project: Project, origin: ProjectOrigin, reason?: string) {
  if (origin !== 'local') return project
  if (!useLibraryStore.getState().save(project, reason)) return null
  return useLibraryStore.getState().projects[project.project_id].project
}

export const useProjectStore = create<ProjectState>()(persist((set, get) => ({
  project: null, origin: 'server', activeNodeId: null, mode: 'builder', navigationStack: [],
  generating: false, analyzing: false, genProgress: null, keywords: [], selectedKeywords: [],
  setProject: (project, requestedOrigin, historyReason) => {
    const origin = requestedOrigin ?? (get().project?.project_id === project.project_id ? get().origin : 'server')
    const saved = saveLocal(project, origin, historyReason)
    if (!saved) return false
    set({ project: saved, origin })
    return true
  },
  adoptCommittedProject: (project) => {
    const current = get()
    if (current.origin !== 'server' || current.project?.project_id !== project.project_id) return
    const active = current.activeNodeId && project.nodes[current.activeNodeId] ? current.activeNodeId : project.root_node_id
    set({ project, activeNodeId: active, navigationStack: active ? pathTo(project, active) : [], mode: active ? current.mode : 'builder' })
  },
  openProject: (project, origin = 'server', mode = 'builder') => {
    workspaceRevision += 1
    const id = project.root_node_id && project.nodes[project.root_node_id] ? project.root_node_id : Object.keys(project.nodes)[0] ?? null
    const saved = saveLocal(project, origin)
    set({ project: saved ?? project, origin, activeNodeId: id, mode, navigationStack: id ? pathTo(project, id) : [], keywords: [], selectedKeywords: [], genProgress: null })
  },
  resetProject: () => { workspaceRevision += 1; set({ project: null, origin: 'server', activeNodeId: null, mode: 'builder', navigationStack: [], generating: false, analyzing: false, genProgress: null, keywords: [], selectedKeywords: [] }) },
  updateNode: (id, update, historyReason) => {
    const { project, origin } = get()
    if (!project?.nodes[id]) return false
    const next = { ...project, nodes: { ...project.nodes, [id]: { ...project.nodes[id], ...update } } }
    const saved = saveLocal(next, origin, historyReason)
    if (!saved) return false
    set({ project: saved })
    return true
  },
  addNode: (node) => {
    const { project, origin } = get()
    if (!project) return
    const nodes = { ...project.nodes, [node.id]: node }
    if (node.parent_id && nodes[node.parent_id]) {
      const parent = nodes[node.parent_id]
      nodes[node.parent_id] = { ...parent, children: Array.from(new Set([...parent.children, node.id])) }
    }
    const next = { ...project, nodes }
    const saved = saveLocal(next, origin)
    if (saved) set({ project: saved })
  },
  updateHotspot: (id, hotspot) => {
    const node = get().project?.nodes[id]
    if (node) get().updateNode(id, { hotspots: node.hotspots.map((item) => item.id === hotspot.id ? hotspot : item) })
  },
  setActiveNode: (id) => get().navigateTo(id),
  navigateInto: (id) => get().navigateTo(id),
  navigateTo: (id) => {
    const project = get().project
    if (project?.nodes[id]) set({ activeNodeId: id, navigationStack: pathTo(project, id) })
  },
  navigateBack: () => {
    const { project, activeNodeId } = get()
    const parent = activeNodeId ? project?.nodes[activeNodeId]?.parent_id : null
    if (parent) get().navigateTo(parent)
  },
  setMode: (mode) => set({ mode }),
  setKeywords: (keywords) => set({ keywords, selectedKeywords: keywords.slice(0, 3).map((item) => item.label) }),
  toggleKeyword: (label) => set((s) => ({ selectedKeywords: s.selectedKeywords.includes(label) ? s.selectedKeywords.filter((item) => item !== label) : [...s.selectedKeywords, label] })),
  setGenerating: (generating) => set({ generating }),
  setAnalyzing: (analyzing) => set({ analyzing }),
  setGenProgress: (genProgress) => set({ genProgress }),
  getActiveNode: () => { const s = get(); return s.activeNodeId ? s.project?.nodes[s.activeNodeId] ?? null : null },
}), {
  name: 'flipbook-project', storage: createJSONStorage(() => localStorage), version: 3,
  migrate: (state) => ({ ...(state as object), origin: 'server' }),
  partialize: (s): PersistedShape => ({ _projectId: s.project?.project_id ?? null, origin: s.origin, activeNodeId: s.activeNodeId, navigationStack: s.navigationStack, mode: s.mode, selectedKeywords: s.selectedKeywords, _exampleProject: s.origin === 'example' ? s.project : null }),
  onRehydrateStorage: () => (state) => {
    const saved = state as (ProjectState & PersistedShape) | undefined
    if (!saved?._projectId) return
    const pid = saved._projectId
    const revision = workspaceRevision
    const restore = (project: Project) => {
      const current = useProjectStore.getState()
      if (revision !== workspaceRevision || (current.project && current.project.project_id !== pid)) return
      const id = saved.activeNodeId && project.nodes[saved.activeNodeId] ? saved.activeNodeId : project.root_node_id
      useProjectStore.setState({ project, origin: saved.origin ?? 'server', activeNodeId: id, navigationStack: id ? pathTo(project, id) : [] })
    }
    queueMicrotask(() => {
      if (saved.origin === 'example') {
        if (saved._exampleProject) restore(saved._exampleProject)
        else useProjectStore.getState().resetProject()
      } else if (saved.origin === 'local') {
        const local = useLibraryStore.getState().projects[pid]?.project
        if (local) restore(local)
        else useProjectStore.getState().resetProject()
      } else {
        import('../api/client').then(({ api }) => api.getProject(pid)).then((project) => restore(project as Project)).catch(() => {
          if (!useProjectStore.getState().project) useProjectStore.getState().resetProject()
        })
      }
    })
  },
}))
