import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGenerationJobs, reconcileGeneration } from './useGenerationJobs'
import { useProjectStore } from '../store/projectStore'
import { projectGenerationLocked, providerConfig, useGenerationJobStore } from '../store/generationJobStore'
import { DEFAULT_MODEL_SETTINGS } from '../store/settingsStore'
import { useNodeDraftStore } from '../store/nodeDraftStore'
import { createExampleProject } from '../data/exampleProject'
import { enqueueMutation } from './workspaceMutationQueue'
import type { GenerationJob } from '../types/jobs'
import { useCreationStore } from '../store/creationStore'

vi.mock('../api/client', () => ({ api: {
  listGenerationJobs: vi.fn(), getGenerationJob: vi.fn(), generationJobEvents: vi.fn(), getProject: vi.fn(),
  createGenerationJob: vi.fn(), provideGenerationCredentials: vi.fn(), cancelGenerationJob: vi.fn(),
} }))
import { api } from '../api/client'

let count = 0
function job(status: GenerationJob['status'], projectId: string): GenerationJob {
  return { job_id: 'job-' + ++count, operation_id: 'operation-' + count, project_id: projectId, node_id: 'root', status,
    phase: 'image', message: '正在生成', pct: 50, last_event_id: count, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    provider_config: providerConfig(DEFAULT_MODEL_SETTINGS), required_credentials: ['llm', 'imggen'], result: null, error: null, confirmation: null }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
beforeEach(() => {
  vi.clearAllMocks()
  useProjectStore.getState().resetProject()
  useGenerationJobStore.setState({ references: {}, jobs: {}, pending: {}, discovery: {}, connection: {}, syncing: {}, submitting: {}, refreshRevision: 0 })
  useNodeDraftStore.setState({ drafts: {} })
  useCreationStore.getState().clear()
  vi.mocked(api.listGenerationJobs).mockResolvedValue({ jobs: [] })
  vi.mocked(api.generationJobEvents).mockImplementation(async function* () { /* EOF is a disconnect, not completion. */ })
})
afterEach(cleanup)

describe('durable job discovery and reconciliation', () => {
  it('discovers the most recent failed analysis in a fresh browser with an empty root', async () => {
    const project = { ...createExampleProject(), root_node_id: null, nodes: {} }
    useProjectStore.getState().openProject(project, 'server')
    const snapshot = { ...job('failed', project.project_id), kind: 'analyze' as const, node_id: null, error: { code: 'rejected', message: '原服务拒绝请求。' } }
    vi.mocked(api.listGenerationJobs).mockImplementation(async (_id, _signal, active = true) => ({ jobs: active ? [] : [snapshot] }))
    vi.mocked(api.getGenerationJob).mockResolvedValue(snapshot)
    vi.mocked(api.getProject).mockResolvedValue(project)
    renderHook(() => useGenerationJobs())
    await waitFor(() => expect(useGenerationJobStore.getState().discovery[project.project_id]).toBe('ready'))
    expect(useGenerationJobStore.getState().jobs[snapshot.job_id]).toEqual(snapshot)
    expect(useProjectStore.getState().activeNodeId).toBeNull()
    expect(projectGenerationLocked(useGenerationJobStore.getState(), project.project_id, 'server')).toBe(false)
    expect(api.listGenerationJobs).toHaveBeenCalledWith(project.project_id, expect.any(AbortSignal), false)
    expect(api.createGenerationJob).not.toHaveBeenCalled()
    expect(api.provideGenerationCredentials).not.toHaveBeenCalled()
  })

  it('keeps only the latest historical snapshot and its partial-result warnings', async () => {
    const project = createExampleProject()
    useProjectStore.getState().openProject(project, 'server')
    const older = Array.from({ length: 99 }, (_, index) => ({ ...job('succeeded', project.project_id), created_at: '2026-10-17T00:00:' + String(index % 60).padStart(2, '0') + 'Z' }))
    const latest = { ...job('partial', project.project_id), created_at: '2026-10-18T00:00:00Z', result: { nodes: [], warnings: ['图片未完成，文字已保留。'] } }
    vi.mocked(api.listGenerationJobs).mockImplementation(async (_id, _signal, active = true) => ({ jobs: active ? [] : [...older.slice(0, 50), latest, ...older.slice(50)] }))
    vi.mocked(api.getGenerationJob).mockResolvedValue(latest)
    vi.mocked(api.getProject).mockResolvedValue(project)
    renderHook(() => useGenerationJobs())
    await waitFor(() => expect(useGenerationJobStore.getState().discovery[project.project_id]).toBe('ready'))
    expect(Object.keys(useGenerationJobStore.getState().jobs)).toEqual([latest.job_id])
    expect(useGenerationJobStore.getState().jobs[latest.job_id].result?.warnings).toEqual(['图片未完成，文字已保留。'])
    expect(api.getProject).toHaveBeenCalledTimes(1)
  })

  it('prioritizes active discovery without requesting history', async () => {
    const project = createExampleProject()
    useProjectStore.getState().openProject(project, 'server')
    const snapshot = job('waiting_credentials', project.project_id)
    vi.mocked(api.listGenerationJobs).mockResolvedValue({ jobs: [snapshot] })
    vi.mocked(api.getGenerationJob).mockResolvedValue(snapshot)
    renderHook(() => useGenerationJobs())
    await waitFor(() => expect(useGenerationJobStore.getState().discovery[project.project_id]).toBe('ready'))
    expect(api.listGenerationJobs).toHaveBeenCalledTimes(1)
    expect(api.listGenerationJobs).toHaveBeenCalledWith(project.project_id, expect.any(AbortSignal))
  })

  it('does not request general history when the exact pending operation is found', async () => {
    const project = createExampleProject()
    useProjectStore.getState().openProject(project, 'server')
    const snapshot = job('succeeded', project.project_id)
    useGenerationJobStore.getState().begin({ operation_id: snapshot.operation_id, project_id: project.project_id, node_id: snapshot.node_id!, selected_keywords: ['original'], provider_config: snapshot.provider_config })
    vi.mocked(api.listGenerationJobs).mockImplementation(async (_id, _signal, _active, operationId) => ({ jobs: operationId ? [snapshot] : [] }))
    vi.mocked(api.getGenerationJob).mockResolvedValue(snapshot)
    vi.mocked(api.getProject).mockResolvedValue(project)
    renderHook(() => useGenerationJobs())
    await waitFor(() => expect(useGenerationJobStore.getState().discovery[project.project_id]).toBe('ready'))
    expect(api.listGenerationJobs).toHaveBeenCalledTimes(2)
    expect(api.listGenerationJobs).not.toHaveBeenCalledWith(project.project_id, expect.any(AbortSignal), false)
    expect(useGenerationJobStore.getState().pending[project.project_id]).toBeUndefined()
  })

  it('allows editing after active discovery succeeds but history cannot be read', async () => {
    const project = createExampleProject()
    useProjectStore.getState().openProject(project, 'server')
    vi.mocked(api.listGenerationJobs).mockImplementation(async (_id, _signal, active = true) => { if (!active) throw new Error('offline'); return { jobs: [] } })
    renderHook(() => useGenerationJobs())
    await waitFor(() => expect(useGenerationJobStore.getState().discovery[project.project_id]).toBe('ready'))
    expect(projectGenerationLocked(useGenerationJobStore.getState(), project.project_id, 'server')).toBe(false)
    expect(useGenerationJobStore.getState().connection[project.project_id]).toContain('暂时无法读取最近结果')
    expect(api.createGenerationJob).not.toHaveBeenCalled()
  })

  it('does not substitute history for an unknown active state', async () => {
    const project = createExampleProject()
    useProjectStore.getState().openProject(project, 'server')
    vi.mocked(api.listGenerationJobs).mockRejectedValue(new Error('offline'))
    renderHook(() => useGenerationJobs())
    await waitFor(() => expect(useGenerationJobStore.getState().discovery[project.project_id]).toBe('error'))
    expect(api.listGenerationJobs).toHaveBeenCalledTimes(1)
    expect(projectGenerationLocked(useGenerationJobStore.getState(), project.project_id, 'server')).toBe(true)
  })

  it('ignores a historical response after switching workspaces', async () => {
    const project = createExampleProject()
    useProjectStore.getState().openProject(project, 'server')
    const history = deferred<{ jobs: GenerationJob[] }>()
    const snapshot = job('failed', project.project_id)
    vi.mocked(api.listGenerationJobs).mockImplementation(async (_id, _signal, active = true) => active ? { jobs: [] } : history.promise)
    renderHook(() => useGenerationJobs())
    await waitFor(() => expect(api.listGenerationJobs).toHaveBeenCalledTimes(2))
    const next = createExampleProject()
    act(() => useProjectStore.getState().openProject(next, 'local'))
    await act(async () => { history.resolve({ jobs: [snapshot] }); await history.promise })
    expect(useGenerationJobStore.getState().jobs[snapshot.job_id]).toBeUndefined()
    expect(useProjectStore.getState().project?.project_id).toBe(next.project_id)
    expect(api.getProject).not.toHaveBeenCalled()
  })

  it('discovers an analysis task with no root and atomically adopts the committed first page', async () => {
    const project = createExampleProject()
    useProjectStore.getState().openProject({ ...project, root_node_id: null, nodes: {} }, 'server')
    const snapshot = { ...job('succeeded', project.project_id), kind: 'analyze' as const, node_id: null, target_node_id: project.root_node_id!,
      result: { nodes: [], node_id: project.root_node_id!, keywords: [{ label: 'water', description: '' }] } }
    useCreationStore.getState().setTopic('submitted topic')
    useCreationStore.getState().markSubmitted(snapshot.operation_id)
    vi.mocked(api.listGenerationJobs).mockResolvedValue({ jobs: [snapshot] })
    vi.mocked(api.getGenerationJob).mockResolvedValue(snapshot)
    vi.mocked(api.getProject).mockResolvedValue(project)
    renderHook(() => useGenerationJobs())
    await waitFor(() => expect(useProjectStore.getState().activeNodeId).toBe(project.root_node_id))
    expect(useProjectStore.getState().navigationStack).toEqual([project.root_node_id])
    expect(useProjectStore.getState().selectedKeywords).toEqual(['water'])
    expect(useCreationStore.getState().topic).toBe('')
    expect(api.createGenerationJob).not.toHaveBeenCalled()
  })

  it('does not clear a new creation draft when a previous root finishes in the background', async () => {
    const project = createExampleProject()
    useProjectStore.getState().openProject({ ...project, root_node_id: null, nodes: {} }, 'server')
    const snapshot = { ...job('partial', project.project_id), kind: 'analyze' as const, node_id: null }
    useCreationStore.getState().markSubmitted(snapshot.operation_id)
    useCreationStore.getState().setTopic('my next project')
    vi.mocked(api.getProject).mockResolvedValue(project)
    await reconcileGeneration(snapshot)
    expect(useCreationStore.getState().topic).toBe('my next project')
    expect(useProjectStore.getState().activeNodeId).toBe(project.root_node_id)
  })

  it.each(['failed', 'cancelled'] as const)('keeps empty-root input after analysis is %s', async (status) => {
    const project = { ...createExampleProject(), root_node_id: null, nodes: {} }
    useProjectStore.getState().openProject(project, 'server')
    const snapshot = { ...job(status, project.project_id), kind: 'analyze' as const, node_id: null }
    useCreationStore.getState().setTopic('retry this topic')
    useCreationStore.getState().markSubmitted(snapshot.operation_id)
    vi.mocked(api.getProject).mockResolvedValue(project)
    await reconcileGeneration(snapshot)
    expect(useProjectStore.getState().activeNodeId).toBeNull()
    expect(useCreationStore.getState().topic).toBe('retry this topic')
  })

  it('applies regeneration to the original ID while preserving navigation and unsaved drafts', async () => {
    const project = createExampleProject()
    const id = project.root_node_id!
    useProjectStore.getState().openProject(project, 'server')
    const child = project.nodes[id].children[0]
    useProjectStore.getState().navigateTo(child)
    const snapshot = { ...job('succeeded', project.project_id), kind: 'regenerate' as const, node_id: id }
    useNodeDraftStore.setState({ drafts: { [project.project_id]: { [id]: { title: 'unsaved', description: 'keep me', scene_document: null } } } })
    vi.mocked(api.getProject).mockResolvedValue({ ...project, nodes: { ...project.nodes, [id]: { ...project.nodes[id], image_url: '/new.png' } } })
    await reconcileGeneration(snapshot)
    expect(useProjectStore.getState().project?.nodes[id].image_url).toBe('/new.png')
    expect(useProjectStore.getState().activeNodeId).toBe(child)
    expect(useNodeDraftStore.getState().drafts[project.project_id][id].description).toBe('keep me')
  })

  it('finds a live server job after reload without submitting or providing credentials', async () => {
    const project = createExampleProject()
    useProjectStore.getState().openProject(project, 'server')
    const snapshot = job('waiting_credentials', project.project_id)
    vi.mocked(api.listGenerationJobs).mockResolvedValue({ jobs: [snapshot] })
    vi.mocked(api.getGenerationJob).mockResolvedValue(snapshot)
    renderHook(() => useGenerationJobs())
    await waitFor(() => expect(useGenerationJobStore.getState().discovery[project.project_id]).toBe('ready'))
    expect(useGenerationJobStore.getState().jobs[snapshot.job_id].status).toBe('waiting_credentials')
    expect(projectGenerationLocked(useGenerationJobStore.getState(), project.project_id, 'server')).toBe(true)
    expect(api.createGenerationJob).not.toHaveBeenCalled()
    expect(api.provideGenerationCredentials).not.toHaveBeenCalled()
  })

  it('recovers a quickly finished operation whose creation response and job ID were lost', async () => {
    const project = createExampleProject()
    useProjectStore.getState().openProject(project, 'server')
    const snapshot = job('succeeded', project.project_id)
    useGenerationJobStore.getState().begin({ operation_id: snapshot.operation_id, project_id: project.project_id, node_id: snapshot.node_id!, selected_keywords: ['original'], provider_config: snapshot.provider_config })
    vi.mocked(api.listGenerationJobs).mockResolvedValue({ jobs: [snapshot] })
    vi.mocked(api.getGenerationJob).mockResolvedValue(snapshot)
    vi.mocked(api.getProject).mockResolvedValue(project)
    renderHook(() => useGenerationJobs())
    await waitFor(() => expect(useGenerationJobStore.getState().pending[project.project_id]).toBeUndefined())
    expect(api.listGenerationJobs).toHaveBeenCalledWith(project.project_id, expect.any(AbortSignal), false, snapshot.operation_id)
    expect(api.createGenerationJob).not.toHaveBeenCalled()
    expect(api.provideGenerationCredentials).not.toHaveBeenCalled()
    await waitFor(() => expect(api.getProject).toHaveBeenCalledTimes(1))
  })

  it('treats an EOF as disconnected and keeps the active job locked', async () => {
    const project = createExampleProject()
    useProjectStore.getState().openProject(project, 'server')
    const snapshot = job('running', project.project_id)
    vi.mocked(api.listGenerationJobs).mockResolvedValue({ jobs: [snapshot] })
    vi.mocked(api.getGenerationJob).mockResolvedValue(snapshot)
    const hook = renderHook(() => useGenerationJobs())
    await waitFor(() => expect(useGenerationJobStore.getState().connection[project.project_id]).toContain('连接已断开'))
    expect(useGenerationJobStore.getState().jobs[snapshot.job_id].status).toBe('running')
    expect(projectGenerationLocked(useGenerationJobStore.getState(), project.project_id, 'server')).toBe(true)
    hook.unmount()
    expect(api.cancelGenerationJob).not.toHaveBeenCalled()
  })

  it('waits for pending mutations, applies the committed result once, and keeps content drafts', async () => {
    const project = createExampleProject()
    useProjectStore.getState().openProject(project, 'server')
    const snapshot = job('partial', project.project_id)
    const write = deferred<void>()
    const mutation = enqueueMutation(project.project_id + '/node/root', () => write.promise)
    useNodeDraftStore.setState({ drafts: { [project.project_id]: { [project.root_node_id!]: { title: '草稿', description: '未提交', scene_document: project.nodes[project.root_node_id!].scene_document ?? null } } } })
    vi.mocked(api.getProject).mockResolvedValue({ ...project, name: 'committed' })
    let first!: Promise<void>
    act(() => { first = reconcileGeneration(snapshot) })
    expect(api.getProject).not.toHaveBeenCalled()
    await act(async () => { write.resolve(); await mutation; await first; await reconcileGeneration(snapshot) })
    expect(api.getProject).toHaveBeenCalledTimes(1)
    expect(useProjectStore.getState().project?.name).toBe('committed')
    expect(useNodeDraftStore.getState().drafts[project.project_id][project.root_node_id!].description).toBe('未提交')
  })

  it('does not overwrite another workspace with an old terminal refresh', async () => {
    const old = createExampleProject()
    useProjectStore.getState().openProject(old, 'server')
    const snapshot = job('cancelled', old.project_id)
    const read = deferred<object>()
    vi.mocked(api.getProject).mockReturnValue(read.promise)
    const reconciliation = reconcileGeneration(snapshot)
    await waitFor(() => expect(api.getProject).toHaveBeenCalled())
    const next = createExampleProject()
    useProjectStore.getState().openProject(next, 'local')
    await act(async () => { read.resolve(old); await reconciliation })
    expect(useProjectStore.getState().project?.project_id).toBe(next.project_id)
    expect(projectGenerationLocked(useGenerationJobStore.getState(), next.project_id, 'local')).toBe(false)
  })

  it('serializes two terminal jobs in one project and holds the edit lock until both reads finish', async () => {
    const project = createExampleProject()
    useProjectStore.getState().openProject(project, 'server')
    useGenerationJobStore.getState().setDiscovery(project.project_id, 'ready')
    const first = job('partial', project.project_id)
    const second = job('cancelled', project.project_id)
    const firstRead = deferred<object>()
    const secondRead = deferred<object>()
    vi.mocked(api.getProject).mockReturnValueOnce(firstRead.promise).mockReturnValueOnce(secondRead.promise)
    const firstSync = reconcileGeneration(first)
    const secondSync = reconcileGeneration(second)
    await waitFor(() => expect(api.getProject).toHaveBeenCalledTimes(1))
    expect(projectGenerationLocked(useGenerationJobStore.getState(), project.project_id, 'server')).toBe(true)
    await act(async () => { firstRead.resolve({ ...project, name: 'first read' }); await firstSync })
    await waitFor(() => expect(api.getProject).toHaveBeenCalledTimes(2))
    expect(projectGenerationLocked(useGenerationJobStore.getState(), project.project_id, 'server')).toBe(true)
    await act(async () => { secondRead.resolve({ ...project, name: 'latest read' }); await secondSync })
    expect(projectGenerationLocked(useGenerationJobStore.getState(), project.project_id, 'server')).toBe(false)
    expect(useProjectStore.getState().project?.name).toBe('latest read')
  })

  it('does not clear the independent legacy regenerate flag when no durable job exists', async () => {
    const project = createExampleProject()
    useProjectStore.getState().openProject(project, 'server')
    useProjectStore.getState().setGenerating(true)
    renderHook(() => useGenerationJobs())
    await waitFor(() => expect(useGenerationJobStore.getState().discovery[project.project_id]).toBe('ready'))
    expect(useProjectStore.getState().generating).toBe(true)
  })
})
