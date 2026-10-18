import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup, waitFor } from '@testing-library/react'
import { useBuilderActions } from './useBuilderActions'
import { useProjectStore } from '../store/projectStore'
import { DEFAULT_MODEL_SETTINGS, useSettingsStore } from '../store/settingsStore'
import { providerConfig, useGenerationJobStore } from '../store/generationJobStore'
import { useCreationStore } from '../store/creationStore'
import type { GenerationJob } from '../types/jobs'
import type { Project } from '../types'

vi.mock('../api/client', () => ({ api: {
  createProject: vi.fn(), createAnalysisJob: vi.fn(), createRegenerationJob: vi.fn(), createGenerationJob: vi.fn(),
  listGenerationJobs: vi.fn(), updateHotspots: vi.fn(), getProject: vi.fn(),
} }))
import { api } from '../api/client'

function job(kind: 'analyze' | 'regenerate'): GenerationJob {
  return { kind, job_id: 'j', operation_id: 'op', project_id: 'p1', node_id: kind === 'analyze' ? null : 'n1',
    status: 'running', phase: 'plan', message: '', pct: 10, last_event_id: 1, created_at: '', updated_at: '',
    provider_config: providerConfig(DEFAULT_MODEL_SETTINGS), required_credentials: ['llm'], result: null, error: null, confirmation: null }
}
const project: Project = { project_id: 'p1', name: 'x', root_node_id: 'n1', settings: {} as never, nodes: {
  n1: { id: 'n1', parent_id: null, depth: 0, title: 'Original', description: 'Keep this content', source_type: 'text', image_url: '/old.png', children: [], hotspots: [], status: 'generated' },
} }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
beforeEach(() => {
  vi.clearAllMocks()
  useProjectStore.getState().resetProject()
  useGenerationJobStore.setState({ jobs: {}, references: {}, pending: {}, discovery: {}, checkedRevision: {}, syncing: {}, submitting: {}, connection: {} })
  useSettingsStore.setState({ ...DEFAULT_MODEL_SETTINGS, llmApiKey: 'valid-fake-key', imgGenApiKey: 'image-fake-key' })
  useCreationStore.getState().clear()
  vi.mocked(api.createProject).mockResolvedValue({ project_id: 'p1', name: 'Topic', settings: {} })
  vi.mocked(api.listGenerationJobs).mockResolvedValue({ jobs: [] })
  vi.mocked(api.createAnalysisJob).mockImplementation(async (pending) => ({ ...job('analyze'), operation_id: pending.operation_id }))
  vi.mocked(api.createRegenerationJob).mockImplementation(async (pending) => ({ ...job('regenerate'), operation_id: pending.operation_id }))
})
afterEach(cleanup)

describe('durable creation submission', () => {
  it.each(['', 'short'])('blocks missing or short LLM credentials before creating a project: %s', async (key) => {
    useSettingsStore.setState({ llmApiKey: key })
    const toast = vi.fn()
    const { result } = renderHook(() => useBuilderActions(toast))
    await act(async () => { await result.current.handleUpload(undefined, 'topic') })
    expect(api.createProject).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith('请先在设置页填写 LLM API Key', 'error')
  })
  it('opens an empty recovery workspace and persists the operation before sending paid work', async () => {
    useCreationStore.getState().setTopic('topic')
    vi.mocked(api.createAnalysisJob).mockImplementation(async (pending) => {
      expect(useProjectStore.getState().project?.root_node_id).toBeNull()
      expect(useProjectStore.getState().project?.project_id).toBe('p1')
      expect(useGenerationJobStore.getState().pending.p1.operation_id).toBe(pending.operation_id)
      expect(localStorage.getItem('flipbook-generation-jobs')).toContain(pending.operation_id)
      return { ...job('analyze'), operation_id: pending.operation_id }
    })
    const { result } = renderHook(() => useBuilderActions(vi.fn()))
    await act(async () => { await result.current.handleUpload(undefined, 'topic') })
    expect(useProjectStore.getState().activeNodeId).toBeNull()
    expect(useProjectStore.getState().analyzing).toBe(false)
    expect(useCreationStore.getState().topic).toBe('topic')
    expect(useGenerationJobStore.getState().jobs.j.kind).toBe('analyze')
  })
  it('keeps the original operation and input when submission response is lost', async () => {
    vi.mocked(api.createAnalysisJob).mockRejectedValue(new Error('response lost'))
    const { result } = renderHook(() => useBuilderActions(vi.fn()))
    await act(async () => { await result.current.handleUpload(undefined, 'original topic', 'keyword') })
    expect(useGenerationJobStore.getState().pending.p1).toEqual(expect.objectContaining({ kind: 'analyze', text: 'original topic', keywords: 'keyword' }))
    expect(useProjectStore.getState().project?.root_node_id).toBeNull()
  })
  it('prevents same-tick duplicate project creation across hook instances', async () => {
    const created = deferred<object>()
    vi.mocked(api.createProject).mockReturnValue(created.promise)
    const { result } = renderHook(() => ({ first: useBuilderActions(vi.fn()), second: useBuilderActions(vi.fn()) }))
    let first!: Promise<void>
    act(() => { first = result.current.first.handleUpload(undefined, 'topic'); void result.current.second.handleUpload(undefined, 'other topic') })
    expect(api.createProject).toHaveBeenCalledTimes(1)
    await act(async () => { created.resolve({ project_id: 'p1', name: 'topic', settings: {} }); await first })
  })
  it('does not submit the old topic if the workspace changes during project bootstrap', async () => {
    const created = deferred<object>()
    vi.mocked(api.createProject).mockReturnValue(created.promise)
    const { result } = renderHook(() => useBuilderActions(vi.fn()))
    let creation!: Promise<void>
    act(() => { creation = result.current.handleUpload(undefined, 'old topic') })
    act(() => useProjectStore.getState().openProject({ ...project, project_id: 'local-next' }, 'local'))
    await act(async () => { created.resolve({ project_id: 'p1', name: 'topic', settings: {} }); await creation })
    expect(api.createAnalysisJob).not.toHaveBeenCalled()
    expect(useProjectStore.getState().project?.project_id).toBe('local-next')
  })
  it('does not duplicate a bootstrap already in progress', async () => {
    useProjectStore.getState().setAnalyzing(true)
    const { result } = renderHook(() => useBuilderActions(vi.fn()))
    await act(async () => { await result.current.handleUpload(undefined, 'topic') })
    expect(api.createProject).not.toHaveBeenCalled()
  })
  it('freezes image generation intent from the original settings', async () => {
    useSettingsStore.setState({ imgGenApiKey: '' })
    const { result } = renderHook(() => useBuilderActions(vi.fn()))
    await act(async () => { await result.current.handleUpload(undefined, 'topic') })
    expect(api.createAnalysisJob).toHaveBeenCalledWith(expect.objectContaining({ generate_images: false }), expect.anything(), undefined)
  })
  it.each(['gpt-image-2', 'dall-e-3'])('only warns about known slow image models: %s', async (model) => {
    useSettingsStore.setState({ imgGenModel: model })
    const toast = vi.fn()
    const { result } = renderHook(() => useBuilderActions(toast))
    await act(async () => { await result.current.handleUpload(undefined, 'topic') })
    const warning = toast.mock.calls.find(([message]) => String(message).includes('单张图约'))
    expect(Boolean(warning)).toBe(model === 'gpt-image-2')
  })
})

describe('durable page regeneration', () => {
  beforeEach(() => { useProjectStore.getState().openProject(project, 'server'); useGenerationJobStore.getState().setDiscovery('p1', 'ready') })
  it('submits a job while keeping the old page untouched', async () => {
    const toast = vi.fn()
    const { result } = renderHook(() => useBuilderActions(toast))
    await act(async () => { await result.current.handleRegenerate() })
    expect(api.createRegenerationJob).toHaveBeenCalledWith(expect.objectContaining({ kind: 'regenerate', node_id: 'n1' }), expect.anything())
    expect(useProjectStore.getState().project?.nodes.n1).toEqual(project.nodes.n1)
    expect(useProjectStore.getState().generating).toBe(false)
    expect(toast).toHaveBeenCalledWith('页面再生任务已提交，原页面会保留到新结果完成', 'success')
  })
  it('can target another page without changing navigation', async () => {
    useProjectStore.getState().setProject({ ...project, nodes: { ...project.nodes, n2: { ...project.nodes.n1, id: 'n2', parent_id: 'n1', depth: 1 } } })
    const { result } = renderHook(() => useBuilderActions(vi.fn()))
    await act(async () => { await result.current.handleRegenerate('n2') })
    expect(api.createRegenerationJob).toHaveBeenCalledWith(expect.objectContaining({ node_id: 'n2' }), expect.anything())
    expect(useProjectStore.getState().activeNodeId).toBe('n1')
  })
  it.each(['hotspot', 'scene'])('protects existing %s content before submission', async (content) => {
    useProjectStore.getState().updateNode('n1', content === 'hotspot' ? { hotspots: [{ id: 'h', label: 'h', position: { x: 0, y: 0 }, size: { width: .2, height: .2 }, selected: true, target_node_id: null }] } : { scene_document: { version: 1, layout: 'atlas', sections: [] } })
    const { result } = renderHook(() => useBuilderActions(vi.fn()))
    await act(async () => { await result.current.handleRegenerate() })
    expect(api.createRegenerationJob).not.toHaveBeenCalled()
  })
  it('releases a definitively rejected regeneration instead of trapping the page in pending', async () => {
    vi.mocked(api.createRegenerationJob).mockRejectedValue(Object.assign(new Error('页面已有热点'), { status: 409 }))
    const { result } = renderHook(() => useBuilderActions(vi.fn()))
    await act(async () => { await result.current.handleRegenerate() })
    await waitFor(() => expect(useGenerationJobStore.getState().pending.p1).toBeUndefined())
    expect(useProjectStore.getState().project?.nodes.n1.image_url).toBe('/old.png')
  })
})
