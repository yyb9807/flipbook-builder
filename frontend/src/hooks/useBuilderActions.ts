import { useRef, useState } from 'react'
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
import { enqueueMutation, hasProjectMutations } from './workspaceMutationQueue'
import { forgetUploadFile, prepareAnalysis, startGeneration, startRegeneration, submitGeneration } from './generationJobs'
import { projectGenerationLocked, useGenerationJobStore } from '../store/generationJobStore'
import type { CreateProjectResponse } from '../types/api'
import { useI18n } from '../i18n'
import { useCopy } from '../i18n/workspace'

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
    return projectGenerationLocked(useGenerationJobStore.getState(), state.project?.project_id, state.origin)
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
    useLibraryStore.getState().save({ ...snapshot, project_id: id, name: snapshot.name + ' · 未保存副本' })
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
    updateNode(nodeId, optimisticPatch)
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
    const operation = async () => {
      const saved = await api.updateHotspots(pid, nodeId, [{ id: hotspot.id, label: hotspot.label, selected: hotspot.selected,
        ...(isImageHotspot(hotspot) ? { pos_x: hotspot.position.x, pos_y: hotspot.position.y, width: hotspot.size.width, height: hotspot.size.height } : {}) }]) as Partial<Pick<FlipNode, 'content_metadata'>> | undefined
      const current = useProjectStore.getState()
      // A terminal job read may have replaced an earlier failed optimistic edit.
      // Reapply only this field's latest accepted operation in its original workspace.
      if (pending.current.get(key) === operation && getWorkspaceRevision() === revision && current.project?.project_id === pid) {
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
    const request = enqueueMutation(`${pid}/${key}`, operation)
    return request.then(() => {
      if (pending.current.get(key) === operation) pending.current.delete(key)
      if (!pending.current.size) setSaveStatus('saved')
    }).catch((e) => {
      setSaveStatus('error')
      const current = useProjectStore.getState().project
      keepRecovery(current?.project_id === pid ? current : { ...project, nodes: { ...project.nodes, [nodeId]: { ...project.nodes[nodeId], ...optimisticPatch } } })
      showToast(`保存失败，已保留本地副本：${(e as Error).message}`, 'error')
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
      try { await enqueueMutation(`${project?.project_id}/${key}`, operation); if (pending.current.get(key) === operation) pending.current.delete(key) }
      catch (e) { setSaveStatus('error'); showToast(`重试失败：${(e as Error).message}`, 'error'); return }
    }
    setSaveStatus(pending.current.size ? 'saving' : 'saved')
  }

  async function handleNodeUpdate(nodeId: string, patch: Partial<FlipNode>): Promise<boolean> {
    if (!project) return false
    if (useProjectStore.getState().generating || durableLocked()) return false
    const pid = project.project_id
    if (patch.title !== undefined || patch.description !== undefined || patch.scene_document !== undefined || patch.content_metadata !== undefined) advanceContentEpoch(pid, nodeId)
    const mutationEpoch = contentEpoch(pid, nodeId)
    updateNode(nodeId, patch)
    if (origin === 'local') return true
    setSaveStatus('saving')
    const key = `node/${nodeId}`
    const revision = getWorkspaceRevision()
    const operation = async () => {
      const saved = await api.updateNode(pid, nodeId, { title: patch.title, description: patch.description, scene_document: patch.scene_document, content_metadata: patch.content_metadata }) as Partial<FlipNode> | undefined
      const current = useProjectStore.getState()
      if (pending.current.get(key) === operation && getWorkspaceRevision() === revision && current.project?.project_id === pid) {
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
      await enqueueMutation(`${project.project_id}/${key}`, operation)
      if (pending.current.get(key) === operation) pending.current.delete(key)
      setSaveStatus(pending.current.size ? 'saving' : 'saved')
      return true
    } catch (e) {
      const current = useProjectStore.getState().project
      keepRecovery(current?.project_id === project.project_id ? current : { ...project, nodes: { ...project.nodes, [nodeId]: { ...project.nodes[nodeId], ...patch } } })
      setSaveStatus('error')
      showToast(`保存失败，已保留本地副本：${(e as Error).message}`, 'error')
      return false
    }
  }

  async function handleAddHotspot() {
    if (!project || !activeNodeId || generating || durableLocked()) return
    const node = project.nodes[activeNodeId]
    if (!node || node.hotspots.length >= 12) return
    const hotspot: Hotspot = { id: newId(), label: '新热点', position: { x: .4, y: .4 }, size: { width: .2, height: .2 }, selected: true, target_node_id: null, score: null }
    setSaveStatus('saving')
    try {
      const saved = origin === 'local' ? hotspot : await api.createHotspot(project.project_id, node.id, { label: hotspot.label, pos_x: .4, pos_y: .4, width: .2, height: .2 }) as Hotspot
      updateNode(node.id, { hotspots: [...useProjectStore.getState().project!.nodes[node.id].hotspots, saved] })
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
    saveStatus,
    retryPending,
  }
}
