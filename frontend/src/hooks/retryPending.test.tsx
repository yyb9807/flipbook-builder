import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBuilderActions } from './useBuilderActions'
import { reconcileGeneration } from './useGenerationJobs'
import { hasProjectMutations } from './workspaceMutationQueue'
import { useProjectStore } from '../store/projectStore'
import { projectGenerationLocked, providerConfig, useGenerationJobStore } from '../store/generationJobStore'
import { DEFAULT_MODEL_SETTINGS } from '../store/settingsStore'
import { useLibraryStore } from '../store/libraryStore'
import { useNodeDraftStore } from '../store/nodeDraftStore'
import { createExampleProject } from '../data/exampleProject'
import type { Project } from '../types'
import type { GenerationJob } from '../types/jobs'

vi.mock('../api/client', () => ({ api: { updateNode: vi.fn(), updateHotspots: vi.fn(), getProject: vi.fn() } }))
import { api } from '../api/client'

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
function terminal(projectId: string, nodeId: string): GenerationJob {
  return { job_id: crypto.randomUUID(), operation_id: crypto.randomUUID(), project_id: projectId, node_id: nodeId, status: 'succeeded', phase: 'done', message: '', pct: 100, last_event_id: 1,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), provider_config: providerConfig(DEFAULT_MODEL_SETTINGS), required_credentials: [], result: null, error: null, confirmation: null }
}
beforeEach(() => {
  vi.resetAllMocks()
  useProjectStore.getState().resetProject()
  useGenerationJobStore.setState({ references: {}, jobs: {}, pending: {}, discovery: {}, checkedRevision: {}, connection: {}, syncing: {}, submitting: {}, refreshRevision: 0 })
  useLibraryStore.setState({ projects: {}, storageError: false })
  useNodeDraftStore.setState({ drafts: {} })
})
afterEach(cleanup)

describe('failed save retries and durable terminal reconciliation', () => {
  it.each(['PATCH-before-GET', 'GET-before-PATCH'] as const)('%s keeps the successful retry visible and preserves newer drafts', async (order) => {
    const project = createExampleProject()
    const pid = project.project_id
    const nid = project.root_node_id!
    const desired = 'Successfully retried title'
    let server: Project = structuredClone(project)
    useProjectStore.getState().openProject(project, 'server')
    useGenerationJobStore.getState().setDiscovery(pid, 'ready')
    const draft = { title: 'Newer unsaved draft', description: 'Draft remains separate', scene_document: null }
    useNodeDraftStore.getState().setDraft(pid, nid, draft)
    vi.mocked(api.updateNode).mockRejectedValueOnce(new Error('offline'))
    const { result } = renderHook(() => useBuilderActions(vi.fn()))
    await act(async () => { expect(await result.current.handleNodeUpdate(nid, { title: desired })).toBe(false) })
    expect(result.current.saveStatus).toBe('error')
    const job = terminal(pid, nid)
    const getResponse = deferred<Project>()
    let snapshotAtGet!: Project
    vi.mocked(api.getProject).mockImplementationOnce(() => { snapshotAtGet = structuredClone(server); return getResponse.promise })
    const patchResponse = deferred<object>()
    vi.mocked(api.updateNode).mockImplementationOnce(async (_pid, id, patch) => {
      await patchResponse.promise
      server = { ...server, nodes: { ...server.nodes, [id]: { ...server.nodes[id], title: patch.title ?? server.nodes[id].title } } }
      return {}
    })
    let retry!: Promise<void>
    let reconciliation!: Promise<void>
    if (order === 'PATCH-before-GET') {
      act(() => { retry = result.current.retryPending() })
      await waitFor(() => expect(api.updateNode).toHaveBeenCalledTimes(2))
      act(() => { reconciliation = reconcileGeneration(job) })
      expect(api.getProject).not.toHaveBeenCalled()
      await act(async () => { patchResponse.resolve({}); await retry })
      await waitFor(() => expect(api.getProject).toHaveBeenCalledTimes(1))
      await act(async () => { getResponse.resolve(snapshotAtGet); await reconciliation })
    } else {
      act(() => { reconciliation = reconcileGeneration(job) })
      await waitFor(() => expect(api.getProject).toHaveBeenCalledTimes(1))
      await act(async () => { await result.current.retryPending() })
      expect(api.updateNode).toHaveBeenCalledTimes(1)
      expect(projectGenerationLocked(useGenerationJobStore.getState(), pid, 'server')).toBe(true)
      await act(async () => { getResponse.resolve(snapshotAtGet); await reconciliation })
      // The server read replaced the old optimistic value, but its retry still exists.
      expect(useProjectStore.getState().project?.nodes[nid].title).toBe(project.nodes[nid].title)
      act(() => { retry = result.current.retryPending() })
      await waitFor(() => expect(api.updateNode).toHaveBeenCalledTimes(2))
      await act(async () => { patchResponse.resolve({}); await retry })
    }
    expect(server.nodes[nid].title).toBe(desired)
    expect(useProjectStore.getState().project?.nodes[nid].title).toBe(desired)
    expect(result.current.saveStatus).toBe('saved')
    expect(hasProjectMutations(pid)).toBe(false)
    expect(projectGenerationLocked(useGenerationJobStore.getState(), pid, 'server')).toBe(false)
    expect(useNodeDraftStore.getState().drafts[pid][nid]).toEqual(draft)
  })

  it('does not replay an old successful retry over a newer edit to the same field', async () => {
    const project = createExampleProject()
    const pid = project.project_id
    const nid = project.root_node_id!
    useProjectStore.getState().openProject(project, 'server')
    useGenerationJobStore.getState().setDiscovery(pid, 'ready')
    vi.mocked(api.updateNode).mockRejectedValueOnce(new Error('offline'))
    const { result } = renderHook(() => useBuilderActions(vi.fn()))
    await act(async () => { await result.current.handleNodeUpdate(nid, { title: 'old retry' }) })
    const old = deferred<object>()
    const latest = deferred<object>()
    vi.mocked(api.updateNode).mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise)
    let retry!: Promise<void>
    let save!: Promise<boolean>
    act(() => { retry = result.current.retryPending() })
    await waitFor(() => expect(api.updateNode).toHaveBeenCalledTimes(2))
    act(() => { save = result.current.handleNodeUpdate(nid, { title: 'latest edit' }) })
    await act(async () => { old.resolve({}); await retry })
    expect(useProjectStore.getState().project?.nodes[nid].title).toBe('latest edit')
    await waitFor(() => expect(api.updateNode).toHaveBeenCalledTimes(3))
    await act(async () => { latest.resolve({}); await save })
    expect(result.current.saveStatus).toBe('saved')
    expect(useProjectStore.getState().project?.nodes[nid].title).toBe('latest edit')
  })

  it('does not apply a successful old retry after the same project is reopened as a new workspace', async () => {
    const project = createExampleProject()
    const pid = project.project_id
    const nid = project.root_node_id!
    useProjectStore.getState().openProject(project, 'server')
    useGenerationJobStore.getState().setDiscovery(pid, 'ready')
    vi.mocked(api.updateNode).mockRejectedValueOnce(new Error('offline'))
    const { result } = renderHook(() => useBuilderActions(vi.fn()))
    await act(async () => { await result.current.handleNodeUpdate(nid, { title: 'old retry' }) })
    const response = deferred<object>()
    vi.mocked(api.updateNode).mockReturnValueOnce(response.promise)
    let retry!: Promise<void>
    act(() => { retry = result.current.retryPending() })
    await waitFor(() => expect(api.updateNode).toHaveBeenCalledTimes(2))
    const reopened = structuredClone(project)
    reopened.nodes[nid].title = 'New workspace state'
    act(() => { useProjectStore.getState().openProject(reopened, 'server') })
    await act(async () => { response.resolve({}); await retry })
    expect(useProjectStore.getState().project?.nodes[nid].title).toBe('New workspace state')
  })

  it('replays accepted hotspot changes after a failed optimistic edit was replaced by a server read', async () => {
    const project = createExampleProject()
    const pid = project.project_id
    const nid = project.root_node_id!
    useProjectStore.getState().openProject(project, 'server')
    useGenerationJobStore.getState().setDiscovery(pid, 'ready')
    vi.mocked(api.updateHotspots).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({})
    const { result } = renderHook(() => useBuilderActions(vi.fn()))
    const changed = { ...project.nodes[nid].hotspots[0], label: 'Accepted hotspot label', target_node_id: null }
    await act(async () => { await result.current.handleHotspotUpdate(changed) })
    const fresh = structuredClone(project)
    fresh.nodes[nid].hotspots[0].target_node_id = 'newly-generated-child'
    fresh.nodes[nid].hotspots[0].score = .9
    act(() => useProjectStore.getState().setProject(fresh, 'server'))
    await act(async () => { await result.current.retryPending() })
    expect(useProjectStore.getState().project?.nodes[nid].hotspots[0].label).toBe(changed.label)
    expect(useProjectStore.getState().project?.nodes[nid].hotspots[0].target_node_id).toBe('newly-generated-child')
    expect(useProjectStore.getState().project?.nodes[nid].hotspots[0].score).toBe(.9)
    expect(result.current.saveStatus).toBe('saved')
  })
})
