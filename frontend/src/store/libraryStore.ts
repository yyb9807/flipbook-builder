import { create } from 'zustand'
import type { Project } from '../types'
import type { LocalPageVersion } from '../types/history'
import { LOCAL_PAGE_VERSION_LIMIT, localVersion, pageContentChanged } from '../utils/pageHistory'

export interface LocalEntry { project: Project; updatedAt: string; versions?: Record<string, LocalPageVersion[]> }
interface LibraryState {
  projects: Record<string, LocalEntry>
  storageError: boolean
  storageConflict: boolean
  save: (project: Project, reason?: string, forceNodeId?: string) => boolean
  remove: (id: string) => boolean
  reload: () => boolean
}
const STORAGE_KEY = 'flipbook-library'
function readProjects(): Record<string, LocalEntry> {
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw ? JSON.parse(raw)?.state?.projects ?? {} : {}
}
function initialProjects() { try { return readProjects() } catch { return {} } }
/** Project and its recovery history are one write. A rejected write never replaces the last durable entry. */
function writeProjects(projects: Record<string, LocalEntry>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { projects }, version: 0 })); return true } catch { return false }
}
export const useLibraryStore = create<LibraryState>()((set, get) => ({
  projects: initialProjects(), storageError: false, storageConflict: false,
  save: (project, reason = 'edit', forceNodeId) => {
    const previous = get().projects[project.project_id]
    let disk: Record<string, LocalEntry>
    try { disk = readProjects() } catch { set({ storageError: true }); return false }
    const diskEntry = disk[project.project_id]
    if ((diskEntry?.project.revision ?? 0) !== (previous?.project.revision ?? 0) || !!diskEntry !== !!previous) {
      set({ storageConflict: true }); return false
    }
    const versions = { ...previous?.versions }
    for (const [nodeId, node] of Object.entries(project.nodes)) {
      let history = versions[nodeId] ?? []
      const oldNode = previous?.project.nodes[nodeId]
      if (!history.length && oldNode) history = [localVersion(oldNode, 1, 'initial')]
      if (!history.length || forceNodeId === nodeId || oldNode && pageContentChanged(oldNode, node)) {
        const sequence = (history[0]?.sequence ?? 0) + 1
        history = [localVersion(node, sequence, history.length ? reason : 'initial'), ...history.map((version) => ({ ...version, is_current: false }))].slice(0, LOCAL_PAGE_VERSION_LIMIT)
      }
      versions[nodeId] = history
    }
    const changed = JSON.stringify(previous?.project) !== JSON.stringify(project)
    const nextProject = { ...project, revision: (previous?.project.revision ?? 0) + (changed || forceNodeId ? 1 : 0) }
    const projects = { ...disk, [project.project_id]: { project: nextProject, versions, updatedAt: new Date().toISOString() } }
    if (!writeProjects(projects)) { set({ storageError: true }); return false }
    set({ projects, storageError: false, storageConflict: false })
    return true
  },
  remove: (id) => {
    let disk: Record<string, LocalEntry>
    try { disk = readProjects() } catch { set({ storageError: true }); return false }
    if ((disk[id]?.project.revision ?? 0) !== (get().projects[id]?.project.revision ?? 0)) { set({ storageConflict: true }); return false }
    const projects = Object.fromEntries(Object.entries(disk).filter(([key]) => key !== id))
    if (!writeProjects(projects)) { set({ storageError: true }); return false }
    set({ projects, storageError: false, storageConflict: false })
    return true
  },
  reload: () => { try { set({ projects: readProjects(), storageConflict: false }); return true } catch { set({ storageError: true }); return false } },
}))
