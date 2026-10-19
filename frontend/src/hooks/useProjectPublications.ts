import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { api } from '../api/client'
import { newId } from '../data/exampleProject'
import { useCopy } from '../i18n/workspace'
import { projectGenerationLocked, useGenerationJobStore } from '../store/generationJobStore'
import { useNodeDraftStore } from '../store/nodeDraftStore'
import { getWorkspaceRevision, useProjectStore } from '../store/projectStore'
import type { Publication } from '../types/publications'
import { getProjectMutationActivity, hasFailedProjectMutations, hasProjectMutations, isHistoryRestoreActive, subscribeProjectMutationActivity } from './workspaceMutationQueue'

interface PendingPublication { operation_id: string; expected_revision: number }
const operationKey = (projectId: string) => `flipbook-publication-operation:${projectId}`
function pendingOperation(projectId: string): PendingPublication | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(operationKey(projectId)) ?? 'null')
    if (value && typeof value.operation_id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value.operation_id)
      && Number.isSafeInteger(value.expected_revision) && value.expected_revision >= 0) {
      return { operation_id: value.operation_id, expected_revision: value.expected_revision }
    }
  } catch { /* An unavailable session store is handled before submitting a new operation. */ }
  return null
}
function clearOperation(projectId: string, operationId: string) {
  if (pendingOperation(projectId)?.operation_id !== operationId) return
  try { sessionStorage.removeItem(operationKey(projectId)) } catch { /* Replaying a retained receipt remains safe. */ }
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause) }

/** Publication requests only carry a saved revision and operation identity, never the editor's optimistic data. */
export function useProjectPublications() {
  const c = useCopy()
  const projectState = useProjectStore()
  const { project, origin } = projectState
  const drafts = useNodeDraftStore((state) => state.drafts)
  const generation = useGenerationJobStore()
  useSyncExternalStore(subscribeProjectMutationActivity, getProjectMutationActivity, getProjectMutationActivity)
  const [publications, setPublications] = useState<Publication[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const mounted = useRef(true)
  const flight = useRef(false)
  const requests = useRef(0)
  const projectId = project?.project_id
  const workspaceRevision = getWorkspaceRevision()

  const current = useCallback((pid: string, workspace: number) => {
    const state = useProjectStore.getState()
    return mounted.current && getWorkspaceRevision() === workspace
      && state.origin === 'server' && state.project?.project_id === pid
  }, [])
  function blockedNow(state = useProjectStore.getState(), draftState = useNodeDraftStore.getState().drafts, generationState = useGenerationJobStore.getState()): string | null {
    const saved = state.project
    if (!saved || state.origin !== 'server') return c('服务器作品可发布固定版本；本地作品可导出离线 ZIP。', 'Server projects can publish fixed versions. Export an offline ZIP for a local project.')
    if (!saved.root_node_id || !saved.nodes[saved.root_node_id]) return c('请先完成作品的第一页。', 'Finish the first page before publishing.')
    if (Object.keys(draftState[saved.project_id] ?? {}).length) return c('请先保存或撤回所有页面草稿，再发布。', 'Save or discard all page drafts before publishing.')
    if (state.generating || state.analyzing || projectGenerationLocked(generationState, saved.project_id, state.origin)) return c('请先完成生成任务和页面同步，再发布。', 'Finish generation and page sync before publishing.')
    if (isHistoryRestoreActive(saved.project_id)) return c('请等待版本恢复或重新载入完成，再发布。', 'Wait for restoration or reloading to finish before publishing.')
    if (hasProjectMutations(saved.project_id) || hasFailedProjectMutations(saved.project_id)) return c('请先完成页面保存；保存失败时，请重试或重新载入已保存版本。', 'Finish saving pages first. Retry failed saves or reload the saved version.')
    if (!Number.isSafeInteger(saved.revision) || saved.revision! < 0) return c('当前页面缺少已保存版本信息，请重新载入作品。', 'Reload the project to obtain its saved revision.')
    return null
  }
  const blockReason = blockedNow(projectState, drafts, generation)

  const reload = useCallback(async () => {
    const epoch = ++requests.current
    const workspace = workspaceRevision
    if (!projectId || origin !== 'server') return
    setLoading(true)
    setError(null)
    try {
      const data = await api.listPublications(projectId)
      if (epoch !== requests.current || !current(projectId, workspace)) return
      setPublications(data.publications)
      setUncertain(Boolean(pendingOperation(projectId)))
    } catch (cause) {
      if (epoch === requests.current && current(projectId, workspace)) setError(message(cause))
    } finally {
      if (epoch === requests.current && current(projectId, workspace)) setLoading(false)
    }
  }, [projectId, origin, workspaceRevision, current])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; requests.current += 1 }
  }, [])
  useEffect(() => {
    requests.current += 1
    setPublications([])
    setLoading(false)
    setError(null)
    setUncertain(Boolean(projectId && pendingOperation(projectId)))
    void reload()
    return () => { requests.current += 1 }
  }, [reload, projectId])

  function receive(publication: Publication) {
    requests.current += 1 // An older list request cannot erase a newly created or withdrawn receipt.
    setLoading(false)
    setPublications((previous) => [publication, ...previous.filter((item) => item.id !== publication.id)]
      .sort((a, b) => b.created_at.localeCompare(a.created_at)))
  }
  async function submit(retry: boolean): Promise<Publication | null> {
    if (flight.current) return null
    const reason = blockedNow()
    if (reason) { setError(reason); return null }
    const state = useProjectStore.getState()
    const saved = state.project!
    if (saved.project_id !== projectId || getWorkspaceRevision() !== workspaceRevision) return null
    const pid = saved.project_id
    const workspace = getWorkspaceRevision()
    let operation = pendingOperation(pid)
    if (!retry && operation) {
      setUncertain(true)
      setError(c('上次发布结果尚未确认。请重试原发布，不会创建重复版本。', 'The previous result is unconfirmed. Retry that publication to avoid a duplicate version.'))
      return null
    }
    if (retry && !operation) {
      setUncertain(false)
      setError(c('没有待确认的发布。请核对当前内容后发布新版本。', 'There is no unconfirmed publication. Review the current content before publishing a new version.'))
      return null
    }
    operation ??= { operation_id: newId(), expected_revision: saved.revision! }
    try {
      // Persist before the request so refreshes and lost responses retain the original revision and identity.
      sessionStorage.setItem(operationKey(pid), JSON.stringify(operation))
    } catch {
      setError(c('浏览器无法保留发布操作，暂未发布。请释放浏览器存储空间后重试。', 'The browser could not preserve this operation, so publishing has not started. Free browser storage and retry.'))
      return null
    }
    flight.current = true
    setBusy(true)
    setError(null)
    setUncertain(true)
    try {
      const result = await api.createPublication(pid, operation.operation_id, operation.expected_revision)
      clearOperation(pid, operation.operation_id)
      if (current(pid, workspace)) { receive(result.publication); setUncertain(false) }
      return current(pid, workspace) ? result.publication : null
    } catch (cause) {
      const status = (cause as Error & { status?: number })?.status
      // A proxy/server failure can follow a committed publish. Only a definitive client rejection clears its identity.
      const unknown = !status || status >= 500 || status === 408
      if (!unknown) clearOperation(pid, operation.operation_id)
      if (current(pid, workspace)) {
        setUncertain(unknown)
        setError(status === 409
          ? c('作品已发生变化。请从版本历史重新载入并核对内容，再发布新版本。', 'The project has changed. Reload it from version history and review the content before publishing a new version.')
          : message(cause))
      }
      return null
    } finally {
      flight.current = false
      if (mounted.current) setBusy(false)
    }
  }
  async function withdraw(publicationId: string): Promise<boolean> {
    if (flight.current) return false
    const state = useProjectStore.getState()
    const pid = state.project?.project_id
    if (pid !== projectId || getWorkspaceRevision() !== workspaceRevision) return false
    if (!pid || state.origin !== 'server' || !publications.some((item) => item.id === publicationId && item.project_id === pid)) return false
    const workspace = getWorkspaceRevision()
    flight.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await api.withdrawPublication(pid, publicationId)
      if (current(pid, workspace)) receive(result.publication)
      return current(pid, workspace)
    } catch (cause) {
      if (current(pid, workspace)) setError(message(cause))
      return false
    } finally { flight.current = false; if (mounted.current) setBusy(false) }
  }
  return { publications, loading, busy, error, uncertain, blockReason, reload,
    publish: () => submit(false), retry: () => submit(true), withdraw }
}
