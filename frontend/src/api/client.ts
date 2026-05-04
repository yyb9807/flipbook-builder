import { useSettingsStore } from '../store/settingsStore'

function getLLMHeaders(): Record<string, string> {
  const s = useSettingsStore.getState()
  return {
    'x-llm-base-url': s.llmBaseUrl,
    'x-llm-api-key': s.llmApiKey,
    'x-llm-model': s.llmModel,
    'x-imggen-base-url': s.imgGenBaseUrl,
    'x-imggen-api-key': s.imgGenApiKey,
    'x-imggen-model': s.imgGenModel,
  }
}

export type SseEvent = Record<string, unknown>

// SSE requests bypass Vite proxy to avoid connection timeout issues with long-running requests.
// 优先级：VITE_API_BASE 环境变量 → 开发环境用 localhost:8000 → 生产环境用同源（部署时由反向代理转发）
const SSE_BACKEND: string = (() => {
  const envBase = import.meta.env.VITE_API_BASE
  if (envBase) return envBase.replace(/\/$/, '')
  if (import.meta.env.DEV) return 'http://localhost:8000'
  return '' // 生产环境使用相对路径，由反向代理把 /api 转到后端
})()

/** 构建请求 headers：注入 LLM 配置 + 自动判断 Content-Type（FormData 时浏览器会自己加 boundary）。 */
function buildHeaders(options: RequestInit): Record<string, string> {
  const headers: Record<string, string> = {
    ...getLLMHeaders(),
    ...(options.headers as Record<string, string> | undefined),
  }
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }
  return headers
}

async function fetchOrThrow(url: string, options: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...options, headers: buildHeaders(options) })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res
}

async function* sseStream(url: string, options: RequestInit): AsyncGenerator<SseEvent> {
  const res = await fetchOrThrow(`${SSE_BACKEND}/api${url}`, options)
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          yield JSON.parse(line.slice(6)) as SseEvent
        } catch {
          // skip malformed
        }
      }
    }
  }
}

async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetchOrThrow(`/api${url}`, options)
  return res.json()
}

export const api = {
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

  analyzeUpload: (projectId: string, file?: File, text?: string, keywords?: string) => {
    const form = new FormData()
    if (file) form.append('file', file)
    if (text) form.append('text', text)
    if (keywords) form.append('keywords', keywords)
    return apiFetch(`/projects/${projectId}/analyze`, {
      method: 'POST',
      body: form,
    })
  },

  updateHotspots: (projectId: string, nodeId: string, hotspots: object[]) =>
    apiFetch(`/projects/${projectId}/nodes/${nodeId}/hotspots`, {
      method: 'PATCH',
      body: JSON.stringify({ hotspots }),
    }),

  generateChildren: (projectId: string, nodeId: string, selectedKeywords: string[] = []) =>
    apiFetch(`/projects/${projectId}/nodes/${nodeId}/generate-children`, {
      method: 'POST',
      body: JSON.stringify({ selected_keywords: selectedKeywords }),
    }),

  generateChildrenStream: (
    projectId: string,
    nodeId: string,
    selectedKeywords: string[] = [],
    signal?: AbortSignal,
  ) =>
    sseStream(`/projects/${projectId}/nodes/${nodeId}/generate-children`, {
      method: 'POST',
      body: JSON.stringify({ selected_keywords: selectedKeywords }),
      signal,
    }),

  analyzeUploadStream: (
    projectId: string,
    file?: File,
    text?: string,
    keywords?: string,
    signal?: AbortSignal,
  ) => {
    const form = new FormData()
    if (file) form.append('file', file)
    if (text) form.append('text', text)
    if (keywords) form.append('keywords', keywords)
    return sseStream(`/projects/${projectId}/analyze`, { method: 'POST', body: form, signal })
  },

  regenerateNode: (projectId: string, nodeId: string) =>
    apiFetch(`/projects/${projectId}/nodes/${nodeId}/regenerate`, {
      method: 'POST',
    }),

  testConfig: () =>
    apiFetch<{
      llm: { ok: boolean; key_length: number; model: string; base_url: string; error: string | null; latency_ms: number | null; sample?: string }
      imggen: { ok: boolean; key_length: number; model: string; base_url: string; error: string | null; latency_ms: number | null }
    }>('/test-config', { method: 'POST' }),

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
