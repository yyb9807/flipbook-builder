import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { newId } from '../data/exampleProject'
import { useProjectStore, getWorkspaceRevision } from '../store/projectStore'
import { useLibraryStore } from '../store/libraryStore'
import { useNodeDraftStore } from '../store/nodeDraftStore'
import { projectGenerationLocked, useGenerationJobStore } from '../store/generationJobStore'
import { acquireHistoryRestore, hasFailedProjectMutations, hasProjectMutations, releaseHistoryRestore, resetProjectMutations } from './workspaceMutationQueue'
import { restorePageSnapshot } from '../utils/pageHistory'
import type { PageRestoreResult, PageVersionDetail, PageVersionSummary } from '../types/history'
import type { Project } from '../types'
import { useCopy } from '../i18n/workspace'

type ToastFn = (message: string, type?: 'success' | 'error' | 'info') => void
export function usePageHistory(showToast: ToastFn) {
  const c = useCopy()
  const project = useProjectStore((state) => state.project)
  const origin = useProjectStore((state) => state.origin)
  const nodeId = useProjectStore((state) => state.activeNodeId)
  const localEntry = useLibraryStore((state) => project ? state.projects[project.project_id] : undefined)
  const [versions, setVersions] = useState<PageVersionSummary[]>([])
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestEpoch = useRef(0)
  const restoreOperations = useRef(new Map<string, { id: string; revision: number }>())
  const projectId = project?.project_id
  const projectRevision = project?.revision
  const refresh = useCallback(async () => {
    const epoch = ++requestEpoch.current
    const workspace = getWorkspaceRevision()
    if (!projectId || !nodeId || origin === 'example') { setVersions([]); setCurrentVersionId(null); return }
    setLoading(true)
    setError(null)
    try {
      const data = origin === 'local' ? { versions: localEntry?.versions?.[nodeId] ?? [], current_version_id: localEntry?.versions?.[nodeId]?.[0]?.id ?? null }
        : await api.listPageVersions(projectId, nodeId)
      if (requestEpoch.current !== epoch || workspace !== getWorkspaceRevision()) return
      setVersions(data.versions)
      setCurrentVersionId(data.current_version_id)
    } catch (cause) { if (requestEpoch.current === epoch && workspace === getWorkspaceRevision()) setError((cause as Error).message) }
    finally { if (requestEpoch.current === epoch) setLoading(false) }
  }, [projectId, nodeId, origin, localEntry])
  useEffect(() => { void refresh(); return () => { requestEpoch.current += 1 } }, [refresh, projectRevision])

  async function getVersion(versionId: string): Promise<PageVersionDetail> {
    const state = useProjectStore.getState()
    if (!state.project || !state.activeNodeId) throw new Error(c('页面已关闭', 'The page is closed'))
    if (state.origin !== 'local') return api.getPageVersion(state.project.project_id, state.activeNodeId, versionId)
    const version = useLibraryStore.getState().projects[state.project.project_id]?.versions?.[state.activeNodeId]?.find((item) => item.id === versionId)
    if (!version) throw new Error(c('此版本已不在浏览器历史中', 'This version is no longer in browser history'))
    const restored = restorePageSnapshot(state.project, state.activeNodeId, version.snapshot)
    return { project_revision: state.project.revision ?? 0, version, preview: restored.node, preserved_branch_count: restored.preserved_branch_count }
  }
  async function restoreVersion(versionId: string): Promise<boolean> {
    const state = useProjectStore.getState()
    const current = state.project
    const id = state.activeNodeId
    if (!current || !id || state.origin === 'example') return false
    const pid = current.project_id
    if (state.generating || projectGenerationLocked(useGenerationJobStore.getState(), pid, state.origin)
      || Object.keys(useNodeDraftStore.getState().drafts[pid] ?? {}).length || hasProjectMutations(pid) || hasFailedProjectMutations(pid)) {
      showToast(c('请先保存或撤回草稿，并完成页面同步和生成任务，再恢复版本。', 'Save or discard drafts and finish page sync and generation before restoring.'), 'info')
      return false
    }
    if (!acquireHistoryRestore(pid)) return false
    const workspace = getWorkspaceRevision()
    setBusy(true)
    setError(null)
    try {
      let result: PageRestoreResult
      if (state.origin === 'local') {
        const version = useLibraryStore.getState().projects[pid]?.versions?.[id]?.find((item) => item.id === versionId)
        if (!version) throw new Error(c('此版本已不在浏览器历史中', 'This version is no longer in browser history'))
        const restored = restorePageSnapshot(current, id, version.snapshot)
        const next = { ...current, nodes: { ...current.nodes, [id]: restored.node } }
        if (!useLibraryStore.getState().save(next, 'restore', id)) throw new Error(c('浏览器未能保存恢复版本。原页面与历史已保留，请释放空间或导出备份。', 'The browser could not save this restoration. The original page and history are kept. Free storage or export a backup.'))
        const entry = useLibraryStore.getState().projects[pid]
        result = { node: entry.project.nodes[id], project_revision: entry.project.revision ?? 0, restored_version_id: entry.versions![id][0].id, preserved_branch_count: restored.preserved_branch_count }
      } else {
        const key = `${pid}/${id}/${versionId}`
        let operation = restoreOperations.current.get(key)
        if (!operation) { operation = { id: newId(), revision: current.revision ?? 0 }; restoreOperations.current.set(key, operation) }
        try { result = await api.restorePageVersion(pid, id, versionId, operation.id, operation.revision) }
        catch (cause) {
          if ((cause as Error & { status?: number }).status === 409) restoreOperations.current.delete(key)
          throw cause
        }
        // A replayed operation can predate another author's edit. Read canonical
        // content after every restore instead of applying an old receipt's node.
        const canonical = await api.getProject(pid) as Project
        const latest = useProjectStore.getState()
        if (workspace === getWorkspaceRevision() && latest.project?.project_id === pid) latest.adoptCommittedProject(canonical)
        restoreOperations.current.delete(key)
      }
      const latest = useProjectStore.getState()
      if (workspace !== getWorkspaceRevision() || latest.project?.project_id !== pid) return true
      if (state.origin === 'local') useProjectStore.setState({ project: { ...latest.project, revision: result.project_revision, nodes: { ...latest.project.nodes, [id]: result.node } } })
      await refresh()
      showToast(c('页面已恢复；已有分支保留，恢复前的内容也可从历史找回。', 'Page restored. Existing branches are kept, and the previous content remains in history.'), 'success')
      return true
    } catch (cause) {
      const message = (cause as Error).message
      if (workspace === getWorkspaceRevision()) { setError(message); showToast(message, 'error') }
      return false
    } finally { releaseHistoryRestore(pid); setBusy(false) }
  }
  async function reloadProject(): Promise<boolean> {
    const state = useProjectStore.getState()
    const current = state.project
    if (!current || state.origin === 'example') return false
    const pid = current.project_id
    if (state.generating || projectGenerationLocked(useGenerationJobStore.getState(), pid, state.origin) || hasProjectMutations(pid)
      || Object.keys(useNodeDraftStore.getState().drafts[pid] ?? {}).length) {
      showToast(c('请先保存或撤回页面草稿，并等待当前同步与生成任务结束。', 'Save or discard page drafts, and wait for sync and generation to finish.'), 'info'); return false
    }
    // Failed optimistic writes may be discarded only after a durable recovery copy exists.
    if (hasFailedProjectMutations(pid) && !useLibraryStore.getState().save({ ...current, project_id: `local-recovery-${pid}`, name: current.name + ' · 未保存副本' })) {
      showToast(c('浏览器未能保留未保存副本，暂不重新载入。请先导出备份。', 'The browser could not preserve unsaved work. Export a backup before reloading.'), 'error'); return false
    }
    if (!acquireHistoryRestore(pid, true)) return false
    const workspace = getWorkspaceRevision()
    setBusy(true)
    try {
      let canonical: Project
      if (state.origin === 'local') {
        if (!useLibraryStore.getState().reload()) throw new Error(c('无法读取浏览器已保存的作品。', 'Could not read the saved browser project.'))
        const entry = useLibraryStore.getState().projects[pid]
        if (!entry) throw new Error(c('此作品已从浏览器移除。', 'This project has been removed from the browser.'))
        canonical = entry.project
      } else canonical = await api.getProject(pid) as Project
      const latest = useProjectStore.getState()
      if (workspace !== getWorkspaceRevision() || latest.project?.project_id !== pid || hasProjectMutations(pid)
        || Object.keys(useNodeDraftStore.getState().drafts[pid] ?? {}).length) return false
      if (state.origin === 'server') latest.adoptCommittedProject(canonical)
      else useProjectStore.setState({ project: canonical, activeNodeId: latest.activeNodeId && canonical.nodes[latest.activeNodeId] ? latest.activeNodeId : canonical.root_node_id })
      resetProjectMutations(pid)
      restoreOperations.current.clear()
      setError(null)
      await refresh()
      showToast(c('已重新载入已保存的页面和版本历史。', 'Saved pages and version history reloaded.'), 'success')
      return true
    } catch (cause) { if (workspace === getWorkspaceRevision()) setError((cause as Error).message); return false }
    finally { releaseHistoryRestore(pid); setBusy(false) }
  }
  return { versions, currentVersionId, loading, error, busy, refresh, getVersion, restoreVersion, reloadProject }
}
