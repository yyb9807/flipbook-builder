import { useSettingsStore, type ModelSettings } from '../store/settingsStore'
import type { TestConfigResult } from '../types/api'
import type { GenerationJob, PendingAnalysis, PendingChildren, PendingRegeneration } from '../types/jobs'
import type { PageRestoreResult, PageVersionDetail, PageVersionList } from '../types/history'
import type { PublicationList, PublicationResult } from '../types/publications'

function getModelHeaders(s: ModelSettings = useSettingsStore.getState()): Record<string, string> {
  return {
    'x-llm-base-url': s.llmBaseUrl,
    'x-llm-api-key': s.llmApiKey,
    'x-llm-model': s.llmModel,
    'x-imggen-base-url': s.imgGenBaseUrl,
    'x-imggen-api-key': s.imgGenApiKey,
    'x-imggen-model': s.imgGenModel,
  }
}

// SSE requests bypass Vite proxy to avoid connection timeout issues with long-running requests.
// 优先级：VITE_API_BASE 环境变量 → 开发环境用 localhost:8000 → 生产环境用同源（部署时由反向代理转发）
const SSE_BACKEND: string = (() => {
  const envBase = import.meta.env.VITE_API_BASE
  if (envBase) return envBase.replace(/\/$/, '')
  if (import.meta.env.DEV) return 'http://localhost:8000'
  return '' // 生产环境使用相对路径，由反向代理把 /api 转到后端
})()

/** Only model operations receive credentials; CRUD and exports never need them. */
function buildHeaders(options: RequestInit, modelSettings?: ModelSettings): Headers {
  const headers = new Headers(modelSettings ? getModelHeaders(modelSettings) : undefined)
  new Headers(options.headers).forEach((value, key) => headers.set(key, value))
  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  return headers
}

async function fetchOrThrow(url: string, options: RequestInit, modelSettings?: ModelSettings): Promise<Response> {
  const res = await fetch(url, { ...options, headers: buildHeaders(options, modelSettings) })
  if (!res.ok) {
    const text = await res.text()
    let message = text || `HTTP ${res.status}`
    try { const body = JSON.parse(text); if (typeof body.detail === 'string') message = body.detail } catch { /* Non-JSON provider/proxy responses remain readable. */ }
    const error = new Error(message) as Error & { status: number }
    error.status = res.status
    throw error
  }
  return res
}

async function apiFetch<T>(url: string, options: RequestInit = {}, modelSettings?: ModelSettings): Promise<T> {
  const res = await fetchOrThrow(`/api${url}`, options, modelSettings)
  return res.json()
}

/** Standard SSE framing, including split UTF-8 chunks, CRLF and multi-line data. */
export async function* readJobEvents(response: Response): AsyncGenerator<GenerationJob> {
  if (!response.body) throw new Error('任务事件流不可用')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let data: string[] = []
  let eventId = ''
  function payload(): GenerationJob | null {
    if (!data.length) return null
    const parsed = JSON.parse(data.join('\n')) as GenerationJob
    if (eventId && /^\d+$/.test(eventId)) parsed.last_event_id = Number(eventId)
    data = []
    eventId = ''
    return parsed
  }
  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      if (done && buffer) { lines.push(buffer); buffer = '' }
      for (const raw of lines) {
        const line = raw.replace(/\r$/, '')
        if (!line) { const job = payload(); if (job) yield job }
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
        else if (line.startsWith('id:')) eventId = line.slice(3).trim()
      }
      if (done) { const job = payload(); if (job) yield job; break }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

export const api = {
  createGenerationJob: (pending: PendingChildren, settings: ModelSettings) =>
    apiFetch<GenerationJob>(`/projects/${pending.project_id}/nodes/${pending.node_id}/generation-jobs`, {
      method: 'POST', body: JSON.stringify({ operation_id: pending.operation_id, selected_keywords: pending.selected_keywords, ...(pending.generate_images !== undefined ? { generate_images: pending.generate_images } : {}) }),
    }, settings),
  createAnalysisJob: (pending: PendingAnalysis, settings: ModelSettings, file?: File) => {
    const form = new FormData()
    form.append('operation_id', pending.operation_id)
    form.append('generate_images', String(pending.generate_images))
    if (pending.text) form.append('text', pending.text)
    if (pending.keywords) form.append('keywords', pending.keywords)
    if (file) form.append('file', file)
    if (pending.file) form.append('file_sha256', pending.file.sha256)
    return apiFetch<GenerationJob>(`/projects/${pending.project_id}/analysis-jobs`, { method: 'POST', body: form }, settings)
  },
  createRegenerationJob: (pending: PendingRegeneration, settings: ModelSettings) =>
    apiFetch<GenerationJob>(`/projects/${pending.project_id}/nodes/${pending.node_id}/regeneration-jobs`, {
      method: 'POST', body: JSON.stringify({ operation_id: pending.operation_id, generate_images: pending.generate_images }),
    }, settings),
  listGenerationJobs: (projectId: string, signal?: AbortSignal, activeOnly = true, operationId?: string) =>
    apiFetch<{ jobs: GenerationJob[] }>(`/projects/${projectId}/jobs?active=${activeOnly}${operationId ? '&operation_id=' + encodeURIComponent(operationId) : ''}`, { signal }),
  getGenerationJob: (jobId: string, signal?: AbortSignal) => apiFetch<GenerationJob>(`/jobs/${jobId}`, { signal }),
  generationJobEvents: async function* (jobId: string, after: number, signal?: AbortSignal) {
    const response = await fetchOrThrow(`${SSE_BACKEND}/api/jobs/${jobId}/events?after=${after}`, { signal, headers: { Accept: 'text/event-stream', 'Last-Event-ID': String(after) } })
    yield* readJobEvents(response)
  },
  provideGenerationCredentials: (jobId: string, settings: ModelSettings) =>
    apiFetch<GenerationJob>(`/jobs/${jobId}/credentials`, { method: 'POST' }, settings),
  retryGenerationJob: (jobId: string, confirmationId: string) =>
    apiFetch<GenerationJob>(`/jobs/${jobId}/retry`, { method: 'POST', body: JSON.stringify({ confirmation_id: confirmationId }) }),
  acceptGenerationJob: (jobId: string, confirmationId: string) =>
    apiFetch<GenerationJob>(`/jobs/${jobId}/accept`, { method: 'POST', body: JSON.stringify({ confirmation_id: confirmationId }) }),
  cancelGenerationJob: (jobId: string) => apiFetch<GenerationJob>(`/jobs/${jobId}/cancel`, { method: 'POST' }),
  createHotspot: (projectId: string, nodeId: string, hotspot: { label: string; pos_x: number; pos_y: number; width: number; height: number; expected_revision?: number }) =>
    apiFetch(`/projects/${projectId}/nodes/${nodeId}/hotspots`, { method: 'POST', body: JSON.stringify(hotspot) }),
  createProject: (name: string, settings?: object) =>
    apiFetch('/projects', {
      method: 'POST',
      body: JSON.stringify({ name, settings }),
    }),

  getProject: (projectId: string) =>
    apiFetch(`/projects/${projectId}`),

  listProjects: () =>
    apiFetch<{
      projects: Array<{
        project_id: string
        name: string
        thumbnail: string | null
        root_title: string | null
        node_count: number
        created_at: string | null
        updated_at: string | null
      }>
    }>('/projects'),

  deleteProject: (projectId: string) =>
    apiFetch(`/projects/${projectId}`, { method: 'DELETE' }),

  listPublications: (projectId: string) => apiFetch<PublicationList>(`/projects/${encodeURIComponent(projectId)}/publications`),
  listAllPublications: () => apiFetch<PublicationList>('/publications'),
  createPublication: (projectId: string, operationId: string, expectedRevision: number) =>
    apiFetch<PublicationResult>(`/projects/${encodeURIComponent(projectId)}/publications`, {
      method: 'POST', body: JSON.stringify({ operation_id: operationId, expected_revision: expectedRevision }),
    }),
  withdrawPublication: (projectId: string, publicationId: string) =>
    apiFetch<PublicationResult>(`/projects/${encodeURIComponent(projectId)}/publications/${encodeURIComponent(publicationId)}`, { method: 'DELETE' }),

  listPageVersions: (projectId: string, nodeId: string) => apiFetch<PageVersionList>(`/projects/${projectId}/nodes/${nodeId}/versions`),
  getPageVersion: (projectId: string, nodeId: string, versionId: string) => apiFetch<PageVersionDetail>(`/projects/${projectId}/nodes/${nodeId}/versions/${versionId}`),
  restorePageVersion: (projectId: string, nodeId: string, versionId: string, operationId: string, expectedRevision: number) =>
    apiFetch<PageRestoreResult>(`/projects/${projectId}/nodes/${nodeId}/versions/${versionId}/restore`, {
      method: 'POST', body: JSON.stringify({ operation_id: operationId, expected_revision: expectedRevision }),
    }),

  updateNode: (projectId: string, nodeId: string, updates: { title?: string; description?: string; scene_document?: unknown; content_metadata?: unknown; expected_revision?: number }) =>
    apiFetch(`/projects/${projectId}/nodes/${nodeId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }),

  updateHotspots: (projectId: string, nodeId: string, hotspots: object[], expectedRevision?: number) =>
    apiFetch(`/projects/${projectId}/nodes/${nodeId}/hotspots`, {
      method: 'PATCH',
      body: JSON.stringify({ hotspots, ...(expectedRevision !== undefined ? { expected_revision: expectedRevision } : {}) }),
    }),

  testConfig: (draft: ModelSettings = useSettingsStore.getState()) =>
    apiFetch<TestConfigResult>('/test-config', { method: 'POST' }, draft),

  /** 导出项目结构 + 节点 + 热点的完整 JSON（不含图片二进制） */
  exportProjectJson: async (projectId: string): Promise<unknown> => {
    const res = await fetch(`/api/projects/${projectId}/export.json`)
    if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`)
    return res.json()
  },

  /** 导出离线 ZIP 包：含 index.html + images/ + README，解压后双击 index.html */
  exportProjectZip: async (projectId: string): Promise<Blob> => {
    const res = await fetch(`/api/projects/${projectId}/export.zip`)
    if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`)
    return res.blob()
  },
}
