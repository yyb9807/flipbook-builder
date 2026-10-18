import { api } from '../api/client'
import { newId } from '../data/exampleProject'
import { useGenerationJobStore, matchesJobSettings, providerConfig } from '../store/generationJobStore'
import { useSettingsStore } from '../store/settingsStore'
import type { PendingAnalysis, PendingGeneration } from '../types/jobs'

const uploadFiles = new Map<string, File>()
export function pendingUploadFile(operationId: string) { return uploadFiles.get(operationId) }
export function forgetUploadFile(operationId: string) { uploadFiles.delete(operationId) }

export async function fileSha256(file: File): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('图片身份校验需要 HTTPS 或 localhost。请使用安全地址重新打开，当前输入仍会保留。')
  const bytes = typeof file.arrayBuffer === 'function' ? await file.arrayBuffer() : await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(new Error('无法读取图片，请重新选择。'))
    reader.readAsArrayBuffer(file)
  })
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

export async function attachPendingUpload(pending: PendingAnalysis, file: File) {
  if (!pending.file || file.size !== pending.file.size || await fileSha256(file) !== pending.file.sha256) {
    throw new Error('这不是原提交的图片。请选择相同文件；更换图片请从工作台开始新作品。')
  }
  uploadFiles.set(pending.operation_id, file)
}

export async function prepareAnalysis(projectId: string, file?: File, text?: string, keywords?: string, generateImages?: boolean): Promise<PendingAnalysis> {
  const settings = useSettingsStore.getState()
  const pending: PendingAnalysis = {
    kind: 'analyze', operation_id: newId(), project_id: projectId, node_id: null,
    provider_config: providerConfig(settings), generate_images: generateImages ?? Boolean(settings.imgGenApiKey.trim()),
    ...(text?.trim() ? { text: text.trim() } : {}), ...(keywords?.trim() ? { keywords: keywords.trim() } : {}),
    ...(file ? { file: { name: file.name, size: file.size, type: file.type, sha256: await fileSha256(file) } } : {}),
  }
  if (file) uploadFiles.set(pending.operation_id, file)
  return pending
}

export async function submitGeneration(pending: PendingGeneration) {
  const store = useGenerationJobStore.getState()
  if (store.submitting[pending.project_id]) return
  const settings = useSettingsStore.getState()
  // Persist the operation before sending: a lost response must reuse its original input.
  store.begin(pending)
  store.setSubmitting(pending.project_id, true)
  store.setConnection(pending.project_id, null)
  try {
    // Read before a retry: the first response may have been lost after the job committed.
    const previous = await api.listGenerationJobs(pending.project_id, undefined, false, pending.operation_id)
    const recovered = previous.jobs.find((job) => job.operation_id === pending.operation_id)
    if (recovered) {
      useGenerationJobStore.getState().receive(recovered)
      forgetUploadFile(pending.operation_id)
      store.refresh()
      return
    }
    if (!matchesJobSettings(pending.provider_config, settings)) throw new Error('请先恢复该任务原来的服务地址和模型，再重试提交。')
    let job
    if (pending.kind === 'analyze') {
      const file = pendingUploadFile(pending.operation_id)
      if (pending.file && !file) throw new Error('原图片仅保留在上次会话。请重新选择同一文件，再用原操作重试。')
      job = await api.createAnalysisJob(pending, settings, file)
    } else if (pending.kind === 'regenerate') job = await api.createRegenerationJob(pending, settings)
    else job = await api.createGenerationJob(pending, settings)
    useGenerationJobStore.getState().receive(job)
    forgetUploadFile(pending.operation_id)
    useGenerationJobStore.getState().refresh()
  } catch (error) {
    const status = (error as { status?: number })?.status
    if (status && status >= 400 && status < 500 && status !== 408 && status !== 409) {
      store.clearPending(pending.project_id)
      forgetUploadFile(pending.operation_id)
      store.setConnection(pending.project_id, '服务器已拒绝这次提交，请修正输入或处理现有任务后重试。')
    } else if (status === 409) {
      // The operation query above found no matching job. A conflict is a rejected new input.
      store.clearPending(pending.project_id)
      forgetUploadFile(pending.operation_id)
      store.setConnection(pending.project_id, (error as Error).message || '当前页面不支持此操作，请核对已有热点与内容。')
    } else store.setConnection(pending.project_id, (error as Error).message.includes('原图片') ? (error as Error).message : '提交结果尚未确认。任务可能已启动；正在保留原操作编号，请查询状态或使用原输入重试提交。')
    store.refresh()
    throw error
  } finally { store.setSubmitting(pending.project_id, false) }
}

export async function startGeneration(projectId: string, nodeId: string, selectedKeywords: string[], generateImages?: boolean) {
  const pending = useGenerationJobStore.getState().pending[projectId]
  if (pending) return submitGeneration(pending)
  return submitGeneration({ kind: 'children', operation_id: newId(), project_id: projectId, node_id: nodeId, selected_keywords: [...selectedKeywords], ...(generateImages !== undefined ? { generate_images: generateImages } : {}), provider_config: providerConfig(useSettingsStore.getState()) })
}

export async function startRegeneration(projectId: string, nodeId: string) {
  const pending = useGenerationJobStore.getState().pending[projectId]
  if (pending) return submitGeneration(pending)
  const settings = useSettingsStore.getState()
  return submitGeneration({ kind: 'regenerate', operation_id: newId(), project_id: projectId, node_id: nodeId,
    generate_images: Boolean(settings.imgGenApiKey.trim()), provider_config: providerConfig(settings) })
}
