import { useEffect, useRef, useState } from 'react'
import { useProjectStore, getWorkspaceRevision } from '../store/projectStore'
import { useSettingsStore } from '../store/settingsStore'
import { api } from '../api/client'
import { findImageModel } from '../utils/llmProviders'
import { useCreationStore } from '../store/creationStore'
import { useLibraryStore } from '../store/libraryStore'
import { useNodeDraftStore } from '../store/nodeDraftStore'
import { newId } from '../data/exampleProject'
import type { Hotspot, Project, FlipNode } from '../types'
import { isImageHotspot } from '../types'
import { authoringRevision, enqueueMutation, hasProjectMutations, isHistoryRestoreActive, onPendingMutationsReset, setMutationFailed } from './workspaceMutationQueue'
import { forgetUploadFile, prepareAnalysis, startGeneration, startRegeneration, submitGeneration } from './generationJobs'
import { projectGenerationLocked, useGenerationJobStore } from '../store/generationJobStore'
import type { CreateProjectResponse } from '../types/api'
import { useI18n } from '../i18n'
import { useCopy } from '../i18n/workspace'
import { connectLocalBranch } from '../utils/localBranches'

type ToastFn = (msg: string, type?: 'success' | 'error' | 'info') => void

const PROJECT_NAME_DEFAULT = '我的翻翻书'
let bootstrapInFlight = false

function hotspotContentPatch(node: FlipNode, hotspot: Hotspot, labelChanged: boolean, resetReview = labelChanged): Partial<FlipNode> {
  return {
    hotspots: node.hotspots.map((item) => item.id === hotspot.id ? hotspot : item),
    ...(labelChanged && node.scene_document ? { scene_document: { ...node.scene_document,
      sections: node.scene_document.sections.map((section) => (section.hotspot_id ?? section.id) === hotspot.id ? { ...section, title: hotspot.label } : section),
    } } : {}),
    ...(resetReview && node.content_metadata ? { content_metadata: { ...node.content_metadata, review_status: 'unreviewed' } } : {}),
  }
}
/**
 * 项目核心操作的 hook：上传分析 / 生成子节点 / 重新生成 / 更新热点。
 * 所有 handler 都从 zustand store 直接拿状态和 setter，调用方只需要传 toast。
 */
export function useBuilderActions(showToast: ToastFn) {
  const { locale } = useI18n()
  const c = useCopy()
  const project = useProjectStore((s) => s.project)
  const activeNodeId = useProjectStore((s) => s.activeNodeId)
  const origin = useProjectStore((s) => s.origin)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const pending = useRef(new Map<string, () => Promise<void>>())
  const contentMutationEpochs = useRef(new Map<string, number>())
  useEffect(() => onPendingMutationsReset((pid) => {
    if (useProjectStore.getState().project?.project_id === pid) { pending.current.clear(); setSaveStatus('saved') }
  }), [])
  const analyzing = useProjectStore((s) => s.analyzing)
  const generating = useProjectStore((s) => s.generating)

  const selectedKeywords = useProjectStore((s) => s.selectedKeywords)
  const updateNode = useProjectStore((s) => s.updateNode)
  const setAnalyzing = useProjectStore((s) => s.setAnalyzing)

  function contentEpoch(projectId: string, nodeId: string) {
    return contentMutationEpochs.current.get(`${projectId}/${nodeId}`) ?? 0
  }
  function advanceContentEpoch(projectId: string, nodeId: string) {
    contentMutationEpochs.current.set(`${projectId}/${nodeId}`, contentEpoch(projectId, nodeId) + 1)
  }
  function localSaveFailure() {
    return useLibraryStore.getState().storageConflict
      ? c('另一标签已更新此作品。原页面和草稿仍保留，请先导出未保存内容，再从版本历史重新载入。', 'Another tab updated this project. Your page and drafts are kept. Export unsaved work, then reload from version history.')
      : c('浏览器未能保存修改，原页面和历史已保留。请释放空间或导出备份。', 'The browser could not save this change. The original page and history are kept. Free storage or export a backup.')
  }

  function checkApiKey(): boolean {
    const key = useSettingsStore.getState().llmApiKey
    if (!key || key.trim().length < 8) {
      showToast('请先在设置页填写 LLM API Key', 'error')
      return false
    }
    return true
  }

  /** 提醒用户当前图片模型偏慢；不阻断流程，只是 warning。 */
  function warnSlowImageModel() {
    const model = findImageModel(useSettingsStore.getState().imgGenModel)
    if (model?.slow && model.seconds) {
      showToast(
        `${model.id} 单张图约 ${Math.round(model.seconds / 60)} 分钟。建议在设置页切换到更快的模型`,
        'info',
      )
    }
  }

  async function handleUpload(file?: File, text?: string, keywords?: string, generateImages?: boolean) {
    if (bootstrapInFlight || analyzing) return
    if (!checkApiKey()) return
    if (!file && !text?.trim()) return
    if (file && file.size > 20 * 1024 * 1024) { showToast('图片不能超过 20 MB', 'error'); return }
    if (generateImages ?? Boolean(useSettingsStore.getState().imgGenApiKey.trim())) warnSlowImageModel()
    bootstrapInFlight = true
    setAnalyzing(true)
    const revision = getWorkspaceRevision()
    let projectId: string | undefined
    try {
      // This request creates no paid work. Only a received project ID can submit a job.
      const created = await api.createProject(text?.trim().slice(0, 60) || file?.name.replace(/\.[^.]+$/, '') || PROJECT_NAME_DEFAULT, {
        max_depth: 4, max_hotspots_per_page: 3, visual_style: 'encyclopedia', language: locale,
      }) as CreateProjectResponse
      if (getWorkspaceRevision() !== revision) return
      projectId = created.project_id
      const pending = await prepareAnalysis(projectId, file, text, keywords, generateImages)
      if (getWorkspaceRevision() !== revision) { forgetUploadFile(pending.operation_id); return }
      useCreationStore.getState().markSubmitted(pending.operation_id)
      // Persist the operation before changing routes. Empty projects have their own recovery UI.
      useGenerationJobStore.getState().begin(pending)
      useProjectStore.getState().openProject({ project_id: projectId, name: created.name, root_node_id: null, settings: created.settings as Project['settings'], nodes: {} }, 'server')
      setAnalyzing(false)
      await submitGeneration(pending)
      showToast(c('创建任务已提交，刷新或离开页面后可继续恢复', 'Creation submitted. You can refresh or return later to recover it.'), 'success')
    } catch (error) {
      if (projectId && useGenerationJobStore.getState().pending[projectId]) showToast('提交结果尚未确认，原操作与输入已保留，请在任务面板查询或重试', 'info')
      else showToast(`创建失败：${(error as Error).message}`, 'error')
    } finally { bootstrapInFlight = false; setAnalyzing(false) }
  }

  function durableLocked() {
    const state = useProjectStore.getState()
    return Boolean(state.project && isHistoryRestoreActive(state.project.project_id)) || projectGenerationLocked(useGenerationJobStore.getState(), state.project?.project_id, state.origin)
  }

  async function handleGenerateChildren(generateImages?: boolean) {
    if (!project || !activeNodeId || generating) return
    if (hasProjectMutations(project.project_id) || pending.current.size) {
      showToast('请等待页面修改保存完成后再生成', 'info')
      return
    }
    if (origin === 'local') { showToast('本地知识页可手动添加分支；AI 图片生成请从工作台创建', 'info'); return }
    if (!checkApiKey()) return
    if (durableLocked()) { showToast('请先核对或处理当前生成任务', 'info'); return }
    if (generateImages ?? Boolean(useSettingsStore.getState().imgGenApiKey.trim())) warnSlowImageModel()
    try {
      await startGeneration(project.project_id, activeNodeId, selectedKeywords, generateImages)
      showToast(c('生成任务已提交，刷新或离开页面后可继续恢复', 'Generation submitted. You can refresh or return later to recover it.'), 'success')
    } catch (error) {
      if (useGenerationJobStore.getState().pending[project.project_id]) showToast('提交结果尚未确认，原操作编号已保留，请在任务面板查询或重试', 'info')
      else showToast(`提交失败：${(error as Error).message}`, 'error')
    }
  }

  /**
   * 重新生成单个页面。
   * @param targetNodeId - 不传则用 activeNodeId（当前页）。
   *   传 id 可针对树里任意节点（如缩略图、TreeNav 上的某行）单独重做。
   */
  async function handleRegenerate(targetNodeId?: string) {
    if (!project || generating || durableLocked()) return
    if (hasProjectMutations(project.project_id) || pending.current.size) {
      showToast('请等待页面修改保存完成后再生成', 'info')
      return
    }
    if (origin !== 'server') { showToast('本地知识页可直接编辑内容', 'info'); return }
    const nodeId = targetNodeId ?? activeNodeId
    if (!nodeId || !checkApiKey()) return
    const node = project.nodes[nodeId]
    if (!node || node.hotspots.length || node.scene_document) {
      showToast('已有热点或结构化内容的页面不能重新生成，请先保留原页面', 'info')
      return
    }
    warnSlowImageModel()
    try {
      await startRegeneration(project.project_id, nodeId)
      showToast('页面再生任务已提交，原页面会保留到新结果完成', 'success')
    } catch (error) {
      if (useGenerationJobStore.getState().pending[project.project_id]) showToast('提交结果尚未确认，原操作编号已保留，请在任务面板查询或重试', 'info')
      else showToast(`再生提交失败：${(error as Error).message}`, 'error')
    }
  }

  function keepRecovery(snapshot: Project) {
    const id = `local-recovery-${snapshot.project_id}`
    return useLibraryStore.getState().save({ ...snapshot, project_id: id, name: snapshot.name + ' · 未保存副本' })
  }

  function handleHotspotUpdate(hotspot: Hotspot): Promise<void> {
    if (!activeNodeId || !project) return Promise.resolve()
    if (useProjectStore.getState().generating || durableLocked()) return Promise.resolve()
    const nodeId = activeNodeId
    const pid = project.project_id
    const revision = getWorkspaceRevision()
    const original = useProjectStore.getState().project
    if (original?.project_id !== pid || !original.nodes[nodeId]) return Promise.resolve()
    const previous = original.nodes[nodeId].hotspots.find((item) => item.id === hotspot.id)
    const labelChanged = !!previous && previous.label !== hotspot.label
    if (labelChanged) advanceContentEpoch(pid, nodeId)
    const optimisticPatch = hotspotContentPatch(original.nodes[nodeId], hotspot, labelChanged)
    if (!updateNode(nodeId, optimisticPatch, 'hotspot_edit')) { showToast(localSaveFailure(), 'error'); return Promise.resolve() }
    const draft = useNodeDraftStore.getState().drafts[pid]?.[nodeId]
    if (labelChanged && draft?.content_metadata?.review_status === 'reviewed') {
      useNodeDraftStore.getState().setDraft(pid, nodeId, { ...draft,
        content_metadata: { ...draft.content_metadata, review_status: 'unreviewed' },
      })
    }
    // Capture before the queue runs: another hotspot may be edited in this tick.
    // Remote project reconciliation does not advance this local authoring epoch.
    const mutationEpoch = contentEpoch(pid, nodeId)
    if (origin === 'local') { setSaveStatus('saved'); return Promise.resolve() }
    const key = `${nodeId}/${hotspot.id}`
    const revisionToken = authoringRevision(pid, revision, original.revision)
    const operation = async () => {
      const saved = await api.updateHotspots(pid, nodeId, [{ id: hotspot.id, label: hotspot.label, selected: hotspot.selected,
        ...(isImageHotspot(hotspot) ? { pos_x: hotspot.position.x, pos_y: hotspot.position.y, width: hotspot.size.width, height: hotspot.size.height } : {}) }], revisionToken.revision) as (Partial<Pick<FlipNode, 'content_metadata'>> & { project_revision?: number }) | undefined
      if (saved?.project_revision !== undefined) revisionToken.revision = saved.project_revision
      setMutationFailed(pid, key, false)
      const current = useProjectStore.getState()
      // A terminal job read may have replaced an earlier failed optimistic edit.
      // Reapply only this field's latest accepted operation in its original workspace.
      if (pending.current.get(key) === operation && getWorkspaceRevision() === revision && current.project?.project_id === pid) {
        if (saved?.project_revision !== undefined && (current.project.revision ?? 0) > saved.project_revision) return
        if (saved?.project_revision !== undefined) useProjectStore.setState({ project: { ...current.project, revision: saved.project_revision } })
        const latestNode = current.project.nodes[nodeId]
        const latest = latestNode?.hotspots.find((item) => item.id === hotspot.id)
        if (latest) {
          const accepted: Hotspot = isImageHotspot(hotspot) && isImageHotspot(latest)
            ? { ...latest, label: hotspot.label, selected: hotspot.selected, position: hotspot.position, size: hotspot.size }
            : { ...latest, label: hotspot.label, selected: hotspot.selected }
          // Other hotspot keys and explicit page saves can finish in either order.
          // A response only owns this operation's local authoring epoch. A server
          // read may replace objects before a failed save is retried.
          current.updateNode(nodeId, { ...hotspotContentPatch(latestNode, accepted, labelChanged, false),
            ...(saved?.content_metadata !== undefined && contentEpoch(pid, nodeId) === mutationEpoch ? { content_metadata: saved.content_metadata } : {}),
          })
        }
      }
    }
    pending.current.set(key, operation)
    setSaveStatus('saving')
    const request = enqueueMutation(`${pid}/authoring`, operation)
    return request.then(() => {
      if (pending.current.get(key) === operation) pending.current.delete(key)
      if (!pending.current.size) setSaveStatus('saved')
    }).catch((e) => {
      setMutationFailed(pid, key, true)
      setSaveStatus('error')
      const current = useProjectStore.getState().project
      const kept = keepRecovery(current?.project_id === pid ? current : { ...project, nodes: { ...project.nodes, [nodeId]: { ...project.nodes[nodeId], ...optimisticPatch } } })
      showToast(`保存失败，${kept ? '已保留本地副本' : '浏览器未能保存副本，修改仍在当前页面或草稿中，请释放空间或手动备份内容'}：${(e as Error).message}`, 'error')
    })
  }

  async function retryPending() {
    if (!project) return
    if (useProjectStore.getState().generating || durableLocked() || hasProjectMutations(project.project_id)) {
      showToast('请等待生成任务与页面同步完成后再重试保存', 'info')
      return
    }
    setSaveStatus('saving')
    for (const [key, operation] of [...pending.current]) {
      try { await enqueueMutation(`${project.project_id}/authoring`, operation); if (pending.current.get(key) === operation) pending.current.delete(key) }
      catch (e) { setSaveStatus('error'); showToast(`重试失败：${(e as Error).message}`, 'error'); return }
    }
    setSaveStatus(pending.current.size ? 'saving' : 'saved')
  }

  async function handleNodeUpdate(nodeId: string, patch: Partial<FlipNode>): Promise<boolean> {
    if (!project) return false
    if (useProjectStore.getState().generating || durableLocked()) return false
    const pid = project.project_id
    const original = useProjectStore.getState().project
    if (original?.project_id !== pid || !original.nodes[nodeId]) return false
    const revision = getWorkspaceRevision()
    const revisionToken = authoringRevision(pid, revision, original.revision)
    if (origin === 'local' && patch.scene_document !== undefined) {
      const kept = new Set(patch.scene_document?.sections.map((section) => section.hotspot_id ?? section.id) ?? [])
      if (original.nodes[nodeId].hotspots.some((hotspot) => hotspot.target_node_id && !kept.has(hotspot.id) && hotspot.kind === 'section')) {
        showToast(c('已有子页的区块需要保留。请编辑其内容，或从版本历史安全恢复。', 'Keep sections connected to existing pages. Edit their content or restore safely from history.'), 'info')
        return false
      }
    }
    if (patch.title !== undefined || patch.description !== undefined || patch.scene_document !== undefined || patch.content_metadata !== undefined) advanceContentEpoch(pid, nodeId)
    const mutationEpoch = contentEpoch(pid, nodeId)
    if (!updateNode(nodeId, patch)) { showToast(localSaveFailure(), 'error'); return false }
    if (origin === 'local') return true
    setSaveStatus('saving')
    const key = `node/${nodeId}`
    const operation = async () => {
      const saved = await api.updateNode(pid, nodeId, { title: patch.title, description: patch.description, scene_document: patch.scene_document, content_metadata: patch.content_metadata, ...(revisionToken.revision !== undefined ? { expected_revision: revisionToken.revision } : {}) }) as (Partial<FlipNode> & { project_revision?: number }) | undefined
      if (saved?.project_revision !== undefined) revisionToken.revision = saved.project_revision
      setMutationFailed(pid, key, false)
      const current = useProjectStore.getState()
      if (pending.current.get(key) === operation && getWorkspaceRevision() === revision && current.project?.project_id === pid) {
        if (saved?.project_revision !== undefined && (current.project.revision ?? 0) > saved.project_revision) return
        if (saved?.project_revision !== undefined) useProjectStore.setState({ project: { ...current.project, revision: saved.project_revision } })
        current.updateNode(nodeId, {
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(contentEpoch(pid, nodeId) === mutationEpoch ? {
            ...(patch.scene_document !== undefined ? { scene_document: patch.scene_document } : {}),
            ...(patch.content_metadata !== undefined ? { content_metadata: patch.content_metadata } : {}),
            ...(saved?.scene_document !== undefined ? { scene_document: saved.scene_document } : {}),
            ...(saved?.content_metadata !== undefined ? { content_metadata: saved.content_metadata } : {}),
            ...(saved?.hotspots !== undefined ? { hotspots: saved.hotspots } : {}),
          } : {}),
        })
      }
    }
    pending.current.set(key, operation)
    try {
      await enqueueMutation(`${pid}/authoring`, operation)
      if (pending.current.get(key) === operation) pending.current.delete(key)
      setSaveStatus(pending.current.size ? 'saving' : 'saved')
      return true
    } catch (e) {
      setMutationFailed(pid, key, true)
      const current = useProjectStore.getState().project
      const kept = keepRecovery(current?.project_id === project.project_id ? current : { ...project, nodes: { ...project.nodes, [nodeId]: { ...project.nodes[nodeId], ...patch } } })
      setSaveStatus('error')
      showToast(`保存失败，${kept ? '已保留本地副本' : '浏览器未能保存副本，修改仍在当前页面或草稿中，请释放空间或手动备份内容'}：${(e as Error).message}`, 'error')
      return false
    }
  }

  function handleCreateLocalBranch(nodeId: string, hotspotId: string): string | null {
    const state = useProjectStore.getState()
    const current = state.project
    if (!current || state.origin !== 'local' || state.generating || isHistoryRestoreActive(current.project_id)) return null
    if (Object.keys(useNodeDraftStore.getState().drafts[current.project_id] ?? {}).length) { showToast(c('请先保存或撤回页面草稿，再添加子页。', 'Save or discard page drafts before adding a page.'), 'info'); return null }
    const connected = connectLocalBranch(current, nodeId, hotspotId, newId(), newId(), c('进一步解释', 'Explain further'))
    if (!connected) return null
    if (!state.setProject(connected.project, 'local', 'branch_create')) { showToast(localSaveFailure(), 'error'); return null }
    return connected.nodeId
  }

  async function handleAddHotspot() {
    const current = useProjectStore.getState()
    if (!current.project || !current.activeNodeId || current.generating || durableLocked()) return
    const pid = current.project.project_id
    const node = current.project.nodes[current.activeNodeId]
    if (!node || node.hotspots.length >= 12 || node.scene_document) return
    const hotspot: Hotspot = { id: newId(), label: '新热点', position: { x: .4, y: .4 }, size: { width: .2, height: .2 }, selected: true, target_node_id: null, score: null }
    const revision = getWorkspaceRevision()
    const revisionToken = authoringRevision(pid, revision, current.project.revision)
    setSaveStatus('saving')
    try {
      if (current.origin === 'local') {
        if (!updateNode(node.id, { hotspots: [...node.hotspots, hotspot] }, 'hotspot_added')) throw new Error(localSaveFailure())
      } else await enqueueMutation(`${pid}/authoring`, async () => {
        const saved = await api.createHotspot(pid, node.id, { label: hotspot.label, pos_x: .4, pos_y: .4, width: .2, height: .2, ...(revisionToken.revision !== undefined ? { expected_revision: revisionToken.revision } : {}) }) as Hotspot & { project_revision?: number }
        if (saved.project_revision !== undefined) revisionToken.revision = saved.project_revision
        const latest = useProjectStore.getState()
        if (revision !== getWorkspaceRevision() || latest.project?.project_id !== pid) return
        if (saved.project_revision !== undefined && (latest.project.revision ?? 0) > saved.project_revision) return
        useProjectStore.setState({ project: { ...latest.project, ...(saved.project_revision !== undefined ? { revision: saved.project_revision } : {}), nodes: { ...latest.project.nodes, [node.id]: { ...latest.project.nodes[node.id], hotspots: [...latest.project.nodes[node.id].hotspots, saved] } } } })
      })
      setSaveStatus('saved')
      showToast('已添加热点，请在画布中拖动校正位置', 'success')
    } catch (e) { setSaveStatus('saved'); showToast(`添加热点失败：${(e as Error).message}`, 'error') }
  }

  return {
    handleUpload,
    handleGenerateChildren,
    handleRegenerate,
    handleHotspotUpdate,
    handleNodeUpdate,
    handleAddHotspot,
    handleCreateLocalBranch,
    saveStatus,
    retryPending,
  }
}
