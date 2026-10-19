import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBuilderActions } from './useBuilderActions'
import { useProjectStore } from '../store/projectStore'
import { useSettingsStore } from '../store/settingsStore'
import { useGenerationJobStore } from '../store/generationJobStore'
import { useLibraryStore } from '../store/libraryStore'
import { useNodeDraftStore } from '../store/nodeDraftStore'
import { NodeContentEditor } from '../components/builder/NodeContentEditor'
import { createExampleProject } from '../data/exampleProject'
import { isImageHotspot } from '../types'
import type { ContentMetadata, Project } from '../types'

vi.mock('../api/client', () => ({ api: { updateNode: vi.fn(), updateHotspots: vi.fn(), createGenerationJob: vi.fn(), createProject: vi.fn(), createAnalysisJob: vi.fn(), listGenerationJobs: vi.fn() } }))
import { api } from '../api/client'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  localStorage.clear()
  useGenerationJobStore.setState({ jobs: {}, references: {}, pending: {}, discovery: {}, syncing: {}, submitting: {} })
  useProjectStore.getState().resetProject()
  useLibraryStore.setState({ projects: {}, storageError: false })
  useNodeDraftStore.setState({ drafts: {} })
  useSettingsStore.setState({ llmApiKey: 'fake-key-for-local-test', imgGenApiKey: '' })
  vi.clearAllMocks()
  vi.mocked(api.listGenerationJobs).mockResolvedValue({ jobs: [] })
})
afterEach(cleanup)

describe('workspace mutation boundaries', () => {
  it('serializes page saves so a slow old request cannot overwrite newer text', async () => {
    const project = createExampleProject()
    const id = project.root_node_id!
    useProjectStore.getState().openProject(project, 'server')
    useGenerationJobStore.getState().setDiscovery(project.project_id, 'ready')
    const first = deferred<object>()
    const second = deferred<object>()
    vi.mocked(api.updateNode).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { result } = renderHook(() => useBuilderActions(vi.fn()))
    let firstSave!: Promise<boolean>
    let secondSave!: Promise<boolean>
    act(() => { firstSave = result.current.handleNodeUpdate(id, { title: 'first' }) })
    await waitFor(() => expect(api.updateNode).toHaveBeenCalledTimes(1))
    act(() => { secondSave = result.current.handleNodeUpdate(id, { title: 'second' }) })
    await Promise.resolve()
    expect(api.updateNode).toHaveBeenCalledTimes(1)
    await act(async () => { first.resolve({}); await firstSave })
    await waitFor(() => expect(api.updateNode).toHaveBeenCalledTimes(2))
    await act(async () => { second.resolve({}); await secondSave })
    expect(useProjectStore.getState().project?.nodes[id].title).toBe('second')
    expect(result.current.saveStatus).toBe('saved')
  })

  it('advances expected revisions only from this authoring queue, even if a concurrent read observes another author', async () => {
    const project = { ...createExampleProject(), revision: 4 }
    const id = project.root_node_id!
    useProjectStore.getState().openProject(project, 'server')
    useGenerationJobStore.getState().setDiscovery(project.project_id, 'ready')
    const first = deferred<object>()
    vi.mocked(api.updateNode).mockReturnValueOnce(first.promise).mockResolvedValueOnce({ project_revision: 6 })
    const { result } = renderHook(() => useBuilderActions(vi.fn()))
    let firstSave!: Promise<boolean>
    let secondSave!: Promise<boolean>
    act(() => { firstSave = result.current.handleNodeUpdate(id, { title: 'First author save' }) })
    await waitFor(() => expect(api.updateNode).toHaveBeenCalledTimes(1))
    expect(vi.mocked(api.updateNode).mock.calls[0][2].expected_revision).toBe(4)
    act(() => {
      useProjectStore.getState().adoptCommittedProject({ ...project, revision: 99 })
      secondSave = result.current.handleNodeUpdate(id, { title: 'Second author save' })
    })
    expect(api.updateNode).toHaveBeenCalledTimes(1)
    await act(async () => { first.resolve({ project_revision: 5 }); await firstSave; await secondSave })
    expect(vi.mocked(api.updateNode).mock.calls[1][2].expected_revision).toBe(5)
    expect(useProjectStore.getState().project?.revision).toBe(99)
  })

  it('does not apply an old upload after the user opens another workspace', async () => {
    const finish = deferred<never>()
    vi.mocked(api.createProject).mockResolvedValue({ project_id: 'server-project', name: 'server', settings: {} })
    vi.mocked(api.createAnalysisJob).mockReturnValue(finish.promise)
    const { result } = renderHook(() => useBuilderActions(vi.fn()))
    let upload!: Promise<void>
    act(() => { upload = result.current.handleUpload(undefined, 'old topic') })
    await waitFor(() => expect(api.createAnalysisJob).toHaveBeenCalled())
    const local = createExampleProject()
    act(() => { useProjectStore.getState().openProject(local, 'local', 'viewer') })
    await act(async () => { finish.resolve({ job_id: 'old-job', operation_id: 'old-operation', project_id: 'server-project', node_id: null, status: 'running', last_event_id: 1 } as never); await upload })
    expect(useProjectStore.getState().project?.project_id).toBe(local.project_id)
    expect(useProjectStore.getState().origin).toBe('local')
  })

  it('preserves a recovery copy when a server save fails', async () => {
    const project = createExampleProject()
    const id = project.root_node_id!
    useProjectStore.getState().openProject(project, 'server')
    useGenerationJobStore.getState().setDiscovery(project.project_id, 'ready')
    vi.mocked(api.updateNode).mockRejectedValue(new Error('offline'))
    const toast = vi.fn()
    const { result } = renderHook(() => useBuilderActions(toast))
    await act(async () => { await result.current.handleNodeUpdate(id, { title: 'unsaved work' }) })
    const recovery = useLibraryStore.getState().projects['local-recovery-' + project.project_id]
    expect(recovery.project.nodes[id].title).toBe('unsaved work')
    expect(result.current.saveStatus).toBe('error')
    const save = localStorage.setItem.bind(localStorage)
    const storage = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === 'flipbook-library') throw new Error('quota')
      save(key, value)
    })
    await act(async () => { expect(await result.current.handleNodeUpdate(id, { title: 'newer work only in this tab' })).toBe(false) })
    expect(toast).toHaveBeenLastCalledWith(expect.stringContaining('修改仍在当前页面或草稿中'), 'error')
    expect(useLibraryStore.getState().projects['local-recovery-' + project.project_id]).toBe(recovery)
    expect(useProjectStore.getState().project?.nodes[id].title).toBe('newer work only in this tab')
    storage.mockRestore()
  })

  it('rejects editing during generation without changing local content', async () => {
    const project = createExampleProject()
    const id = project.root_node_id!
    useProjectStore.getState().openProject(project, 'server')
    useGenerationJobStore.getState().setDiscovery(project.project_id, 'ready')
    useProjectStore.getState().setGenerating(true)
    const { result } = renderHook(() => useBuilderActions(vi.fn()))
    await act(async () => {
      expect(await result.current.handleNodeUpdate(id, { title: 'blocked' })).toBe(false)
      await result.current.handleHotspotUpdate({ ...project.nodes[id].hotspots[0], label: 'blocked' })
    })
    expect(useProjectStore.getState().project?.nodes[id].title).toBe(project.nodes[id].title)
    expect(api.updateNode).not.toHaveBeenCalled()
    expect(api.updateHotspots).not.toHaveBeenCalled()
  })

  it('waits for outstanding saves before allowing a generation to start', async () => {
    const project = createExampleProject()
    const id = project.root_node_id!
    useProjectStore.getState().openProject(project, 'server')
    useGenerationJobStore.getState().setDiscovery(project.project_id, 'ready')
    const request = deferred<object>()
    vi.mocked(api.updateNode).mockReturnValue(request.promise)
    const { result } = renderHook(() => useBuilderActions(vi.fn()))
    let save!: Promise<boolean>
    act(() => { save = result.current.handleNodeUpdate(id, { title: 'pending' }) })
    await waitFor(() => expect(api.updateNode).toHaveBeenCalled())
    await act(async () => { await result.current.handleGenerateChildren() })
    expect(api.createGenerationJob).not.toHaveBeenCalled()
    expect(useProjectStore.getState().generating).toBe(false)
    await act(async () => { request.resolve({}); await save })
  })

  it('adopts canonical section identities and metadata returned by a page save', async () => {
    const project = createExampleProject()
    const id = project.root_node_id!
    useProjectStore.getState().openProject(project, 'server')
    useGenerationJobStore.getState().setDiscovery(project.project_id, 'ready')
    const metadata = { version: 1 as const, references: [{ id: 'ref', title: 'Water book' }], review_status: 'reviewed' as const }
    const scene = { version: 1 as const, layout: 'atlas' as const, sections: [{ id: 'new-section', title: '新知识', body: '这是新的知识正文。' }] }
    const canonicalScene = { ...scene, sections: [{ ...scene.sections[0], hotspot_id: 'server-section-id' }] }
    const canonicalHotspots = [{ id: 'server-section-id', kind: 'section' as const, label: '新知识', selected: true, target_node_id: null }]
    vi.mocked(api.updateNode).mockResolvedValue({ scene_document: canonicalScene, hotspots: canonicalHotspots, content_metadata: metadata })
    const { result } = renderHook(() => useBuilderActions(vi.fn()))
    await act(async () => { expect(await result.current.handleNodeUpdate(id, { scene_document: scene, content_metadata: metadata })).toBe(true) })
    expect(api.updateNode).toHaveBeenCalledWith(project.project_id, id, expect.objectContaining({ scene_document: scene, content_metadata: metadata }))
    expect(useProjectStore.getState().project?.nodes[id].scene_document).toEqual(canonicalScene)
    expect(useProjectStore.getState().project?.nodes[id].hotspots).toEqual(canonicalHotspots)
    expect(useProjectStore.getState().project?.nodes[id].content_metadata).toEqual(metadata)
  })

  it('updates section selection without sending fabricated image coordinates', async () => {
    const project = createExampleProject()
    const id = project.root_node_id!
    const connection = { id: 'section', kind: 'section' as const, label: '蒸发', selected: false, target_node_id: null, position: null, size: null }
    project.nodes[id].hotspots = [connection]
    useProjectStore.getState().openProject(project, 'server')
    useGenerationJobStore.getState().setDiscovery(project.project_id, 'ready')
    vi.mocked(api.updateHotspots).mockResolvedValue({})
    const { result } = renderHook(() => useBuilderActions(vi.fn()))
    await act(async () => { await result.current.handleHotspotUpdate({ ...connection, selected: true }) })
    expect(api.updateHotspots).toHaveBeenCalledWith(project.project_id, id, [{ id: 'section', label: '蒸发', selected: true }], undefined)
  })
})

describe('hotspot labels and author review', () => {
  function reviewedProject(): Project {
    const project = createExampleProject()
    project.nodes[project.root_node_id!].content_metadata = {
      version: 1, review_status: 'reviewed', references: [{ id: 'ref', title: 'Author reference' }],
    }
    return project
  }

  it.each(['local', 'server'] as const)('%s clears review optimistically only for a changed label and keeps a matching section title in sync', async (origin) => {
    const project = reviewedProject()
    const id = project.root_node_id!
    const response = deferred<object>()
    vi.mocked(api.updateHotspots).mockReturnValue(response.promise)
    useProjectStore.getState().openProject(project, origin)
    useGenerationJobStore.getState().setDiscovery(project.project_id, 'ready')
    const { result } = renderHook(() => useBuilderActions(vi.fn()))
    let save!: Promise<void>
    act(() => { save = result.current.handleHotspotUpdate({ ...project.nodes[id].hotspots[0], label: 'Updated explanation topic' }) })
    expect(useProjectStore.getState().project?.nodes[id].content_metadata?.review_status).toBe('unreviewed')
    expect(useProjectStore.getState().project?.nodes[id].scene_document?.sections[0].title).toBe('Updated explanation topic')
    if (origin === 'server') {
      await waitFor(() => expect(api.updateHotspots).toHaveBeenCalledTimes(1))
      const metadata: ContentMetadata = { ...project.nodes[id].content_metadata!, review_status: 'unreviewed' }
      await act(async () => { response.resolve({ status: 'ok', content_metadata: metadata }); await save })
      expect(useProjectStore.getState().project?.nodes[id].content_metadata).toEqual(metadata)
    } else {
      await act(async () => { await save })
      expect(api.updateHotspots).not.toHaveBeenCalled()
      expect(useLibraryStore.getState().projects[project.project_id].project.nodes[id].content_metadata?.review_status).toBe('unreviewed')
    }
  })

  it.each(['selection', 'geometry', 'unchanged-label'] as const)('%s keeps the author review and supports an older empty PATCH response', async (change) => {
    const project = reviewedProject()
    const id = project.root_node_id!
    const hotspot = project.nodes[id].hotspots[0]
    if (!isImageHotspot(hotspot)) throw new Error('The fixture must retain an image hotspot')
    const changed = change === 'selection' ? { ...hotspot, selected: !hotspot.selected }
      : change === 'geometry' ? { ...hotspot, position: { x: .2, y: .3 } } : { ...hotspot }
    useProjectStore.getState().openProject(project, 'server')
    useGenerationJobStore.getState().setDiscovery(project.project_id, 'ready')
    vi.mocked(api.updateHotspots).mockResolvedValue({})
    const { result } = renderHook(() => useBuilderActions(vi.fn()))
    await act(async () => { await result.current.handleHotspotUpdate(changed) })
    expect(useProjectStore.getState().project?.nodes[id].content_metadata?.review_status).toBe('reviewed')
  })

  it('does not merge metadata from an older hotspot operation over a newer edit', async () => {
    const project = reviewedProject()
    const id = project.root_node_id!
    useProjectStore.getState().openProject(project, 'server')
    useGenerationJobStore.getState().setDiscovery(project.project_id, 'ready')
    const first = deferred<object>()
    const second = deferred<object>()
    vi.mocked(api.updateHotspots).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { result } = renderHook(() => useBuilderActions(vi.fn()))
    let firstSave!: Promise<void>
    let secondSave!: Promise<void>
    act(() => { firstSave = result.current.handleHotspotUpdate({ ...project.nodes[id].hotspots[0], label: 'Old rename' }) })
    await waitFor(() => expect(api.updateHotspots).toHaveBeenCalledTimes(1))
    act(() => { secondSave = result.current.handleHotspotUpdate({ ...project.nodes[id].hotspots[0], label: 'Latest rename' }) })
    await act(async () => { first.resolve({ status: 'ok', content_metadata: null }); await firstSave })
    expect(useProjectStore.getState().project?.nodes[id].hotspots[0].label).toBe('Latest rename')
    expect(useProjectStore.getState().project?.nodes[id].content_metadata?.references[0].title).toBe('Author reference')
    await waitFor(() => expect(api.updateHotspots).toHaveBeenCalledTimes(2))
    await act(async () => { second.resolve({ status: 'ok', content_metadata: { ...project.nodes[id].content_metadata!, review_status: 'unreviewed' } }); await secondSave })
    expect(result.current.saveStatus).toBe('saved')
  })

  it('does not merge old hotspot metadata after reopening the same project', async () => {
    const project = reviewedProject()
    const id = project.root_node_id!
    const response = deferred<object>()
    useProjectStore.getState().openProject(project, 'server')
    useGenerationJobStore.getState().setDiscovery(project.project_id, 'ready')
    vi.mocked(api.updateHotspots).mockReturnValue(response.promise)
    const { result } = renderHook(() => useBuilderActions(vi.fn()))
    let save!: Promise<void>
    act(() => { save = result.current.handleHotspotUpdate({ ...project.nodes[id].hotspots[0], label: 'Old workspace rename' }) })
    await waitFor(() => expect(api.updateHotspots).toHaveBeenCalledTimes(1))
    act(() => { useProjectStore.getState().openProject(structuredClone(project), 'server') })
    await act(async () => { response.resolve({ status: 'ok', content_metadata: null }); await save })
    expect(useProjectStore.getState().project?.nodes[id].content_metadata?.review_status).toBe('reviewed')
    expect(useProjectStore.getState().project?.nodes[id].hotspots[0].label).toBe(project.nodes[id].hotspots[0].label)
  })

  it('serializes different hotspots and does not revive review after a newer optimistic rename', async () => {
    const project = reviewedProject()
    const id = project.root_node_id!
    const geometryHotspot = project.nodes[id].hotspots[0]
    if (!isImageHotspot(geometryHotspot)) throw new Error('The fixture must retain an image hotspot')
    const geometryResponse = deferred<object>()
    const renameResponse = deferred<object>()
    vi.mocked(api.updateHotspots).mockReturnValueOnce(geometryResponse.promise).mockReturnValueOnce(renameResponse.promise)
    useProjectStore.getState().openProject(project, 'server')
    useGenerationJobStore.getState().setDiscovery(project.project_id, 'ready')
    const { result } = renderHook(() => useBuilderActions(vi.fn()))
    let geometrySave!: Promise<void>
    let renameSave!: Promise<void>
    act(() => { geometrySave = result.current.handleHotspotUpdate({ ...geometryHotspot, position: { x: .2, y: .3 } }) })
    await waitFor(() => expect(api.updateHotspots).toHaveBeenCalledTimes(1))
    act(() => { renameSave = result.current.handleHotspotUpdate({ ...project.nodes[id].hotspots[1], label: 'Changed topic' }) })
    expect(api.updateHotspots).toHaveBeenCalledTimes(1)
    const unreviewed: ContentMetadata = { ...project.nodes[id].content_metadata!, review_status: 'unreviewed' }
    await act(async () => { geometryResponse.resolve({ status: 'ok', content_metadata: project.nodes[id].content_metadata }); await geometrySave })
    expect(useProjectStore.getState().project?.nodes[id].content_metadata?.review_status).toBe('unreviewed')
    await waitFor(() => expect(api.updateHotspots).toHaveBeenCalledTimes(2))
    await act(async () => { renameResponse.resolve({ status: 'ok', content_metadata: unreviewed }); await renameSave })
    expect(useProjectStore.getState().project?.nodes[id].content_metadata).toBe(unreviewed)
    expect(useProjectStore.getState().project?.nodes[id].hotspots[0].position).toEqual({ x: .2, y: .3 })
    expect(useProjectStore.getState().project?.nodes[id].hotspots[1].label).toBe('Changed topic')
  })

  it('binds each hotspot metadata version before same-tick requests enter their queues', async () => {
    const project = reviewedProject()
    const id = project.root_node_id!
    const firstHotspot = project.nodes[id].hotspots[0]
    if (!isImageHotspot(firstHotspot)) throw new Error('The fixture must retain an image hotspot')
    const geometryResponse = deferred<object>()
    const renameResponse = deferred<object>()
    vi.mocked(api.updateHotspots).mockReturnValueOnce(geometryResponse.promise).mockReturnValueOnce(renameResponse.promise)
    useProjectStore.getState().openProject(project, 'server')
    useGenerationJobStore.getState().setDiscovery(project.project_id, 'ready')
    const { result } = renderHook(() => useBuilderActions(vi.fn()))
    let geometrySave!: Promise<void>
    let renameSave!: Promise<void>
    act(() => {
      geometrySave = result.current.handleHotspotUpdate({ ...firstHotspot, position: { x: .2, y: .3 } })
      renameSave = result.current.handleHotspotUpdate({ ...project.nodes[id].hotspots[1], label: 'Same-tick renamed topic' })
    })
    const renamedMetadata = useProjectStore.getState().project?.nodes[id].content_metadata
    expect(renamedMetadata?.review_status).toBe('unreviewed')
    await waitFor(() => expect(api.updateHotspots).toHaveBeenCalledTimes(1))
    await act(async () => { geometryResponse.resolve({ status: 'ok', content_metadata: project.nodes[id].content_metadata }); await geometrySave })
    await waitFor(() => expect(api.updateHotspots).toHaveBeenCalledTimes(2))
    expect(useProjectStore.getState().project?.nodes[id].content_metadata).toBe(renamedMetadata)
    expect(useProjectStore.getState().project?.nodes[id].content_metadata?.review_status).toBe('unreviewed')
    await act(async () => { renameResponse.resolve({ status: 'ok', content_metadata: { ...project.nodes[id].content_metadata!, review_status: 'unreviewed' } }); await renameSave })
    expect(useProjectStore.getState().project?.nodes[id].content_metadata?.review_status).toBe('unreviewed')
    expect(result.current.saveStatus).toBe('saved')
  })

  it.each(['geometry', 'rename'] as const)('does not let a late %s response overwrite a later explicit content-metadata save', async (change) => {
    const project = reviewedProject()
    const id = project.root_node_id!
    project.nodes[id].content_metadata!.provenance = { kind: 'ai', input_kind: 'image', model: 'recorded-model' }
    const hotspot = project.nodes[id].hotspots[0]
    if (!isImageHotspot(hotspot)) throw new Error('The fixture must retain an image hotspot')
    const response = deferred<object>()
    vi.mocked(api.updateHotspots).mockReturnValue(response.promise)
    const reviewed: ContentMetadata = {
      ...project.nodes[id].content_metadata!, references: [{ id: 'new-reference', title: 'New author reference', note: 'A later manual check' }], review_status: 'reviewed',
    }
    vi.mocked(api.updateNode).mockResolvedValue({ content_metadata: reviewed })
    useProjectStore.getState().openProject(project, 'server')
    useGenerationJobStore.getState().setDiscovery(project.project_id, 'ready')
    const { result } = renderHook(() => useBuilderActions(vi.fn()))
    let hotspotSave!: Promise<void>
    const changed = change === 'rename' ? { ...hotspot, label: 'Renamed before the author checked it' }
      : { ...hotspot, position: { x: .2, y: .3 } }
    act(() => { hotspotSave = result.current.handleHotspotUpdate(changed) })
    await waitFor(() => expect(api.updateHotspots).toHaveBeenCalledTimes(1))
    let contentSave!: Promise<boolean>
    act(() => { contentSave = result.current.handleNodeUpdate(id, { content_metadata: reviewed }) })
    expect(api.updateNode).not.toHaveBeenCalled()
    expect(useProjectStore.getState().project?.nodes[id].content_metadata).toBe(reviewed)
    const staleMetadata = { ...project.nodes[id].content_metadata!, review_status: change === 'rename' ? 'unreviewed' : 'reviewed' }
    await act(async () => { response.resolve({ status: 'ok', content_metadata: staleMetadata }); await hotspotSave; expect(await contentSave).toBe(true) })
    expect(useProjectStore.getState().project?.nodes[id].content_metadata).toBe(reviewed)
    expect(useProjectStore.getState().project?.nodes[id].content_metadata?.references[0].title).toBe('New author reference')
    expect(useProjectStore.getState().project?.nodes[id].content_metadata?.review_status).toBe('reviewed')
    expect(useProjectStore.getState().project?.nodes[id].content_metadata?.provenance).toEqual(reviewed.provenance)
  })

  it('adopts the canonical unreviewed metadata when a failed rename is retried after a stale server read', async () => {
    const project = reviewedProject()
    const id = project.root_node_id!
    const canonical: ContentMetadata = { ...project.nodes[id].content_metadata!, review_status: 'unreviewed' }
    vi.mocked(api.updateHotspots).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ status: 'ok', content_metadata: canonical })
    useProjectStore.getState().openProject(project, 'server')
    useGenerationJobStore.getState().setDiscovery(project.project_id, 'ready')
    const { result } = renderHook(() => useBuilderActions(vi.fn()))
    await act(async () => { await result.current.handleHotspotUpdate({ ...project.nodes[id].hotspots[0], label: 'Retried image topic' }) })
    expect(result.current.saveStatus).toBe('error')
    act(() => { useProjectStore.getState().adoptCommittedProject(structuredClone(project)) })
    expect(useProjectStore.getState().project?.nodes[id].content_metadata?.review_status).toBe('reviewed')
    await act(async () => { await result.current.retryPending() })
    expect(useProjectStore.getState().project?.nodes[id].content_metadata).toBe(canonical)
    expect(useProjectStore.getState().project?.nodes[id].hotspots[0].label).toBe('Retried image topic')
    expect(useProjectStore.getState().project?.nodes[id].scene_document?.sections[0].title).toBe('Retried image topic')
    expect(result.current.saveStatus).toBe('saved')
  })

  it('does not revive review or stale scene/hotspot snapshots from a node save that finishes after a newer rename', async () => {
    const project = reviewedProject()
    const id = project.root_node_id!
    const nodeResponse = deferred<object>()
    vi.mocked(api.updateNode).mockReturnValue(nodeResponse.promise)
    const reviewed: ContentMetadata = { ...project.nodes[id].content_metadata!, references: [{ id: 'new-reference', title: 'Updated reference' }] }
    const unreviewed: ContentMetadata = { ...reviewed, review_status: 'unreviewed' }
    vi.mocked(api.updateHotspots).mockResolvedValue({ status: 'ok', content_metadata: unreviewed })
    useProjectStore.getState().openProject(project, 'server')
    useGenerationJobStore.getState().setDiscovery(project.project_id, 'ready')
    const { result } = renderHook(() => useBuilderActions(vi.fn()))
    let contentSave!: Promise<boolean>
    act(() => { contentSave = result.current.handleNodeUpdate(id, { content_metadata: reviewed }) })
    await waitFor(() => expect(api.updateNode).toHaveBeenCalledTimes(1))
    let renameSave!: Promise<void>
    act(() => { renameSave = result.current.handleHotspotUpdate({ ...project.nodes[id].hotspots[0], label: 'Topic changed after the check' }) })
    expect(useProjectStore.getState().project?.nodes[id].content_metadata?.review_status).toBe('unreviewed')
    expect(api.updateHotspots).not.toHaveBeenCalled()
    await act(async () => { nodeResponse.resolve({ content_metadata: reviewed, scene_document: structuredClone(project.nodes[id].scene_document), hotspots: structuredClone(project.nodes[id].hotspots) }); await contentSave; await renameSave })
    expect(useProjectStore.getState().project?.nodes[id].content_metadata).toBe(unreviewed)
    expect(useProjectStore.getState().project?.nodes[id].content_metadata?.references[0].title).toBe('Updated reference')
    expect(useProjectStore.getState().project?.nodes[id].hotspots[0].label).toBe('Topic changed after the check')
    expect(useProjectStore.getState().project?.nodes[id].scene_document?.sections[0].title).toBe('Topic changed after the check')
  })

  it('invalidates an unsaved author declaration before a hotspot rename and cannot revive it when the content draft is saved', async () => {
    const project = reviewedProject()
    const id = project.root_node_id!
    project.nodes[id].scene_document = null
    project.nodes[id].content_metadata!.provenance = { kind: 'ai', input_kind: 'image', model: 'content-model' }
    const draft = { title: 'Unsaved title', description: 'Keep the unsaved explanation', scene_document: null,
      content_metadata: structuredClone(project.nodes[id].content_metadata!),
    }
    const otherDraft = structuredClone(draft)
    useNodeDraftStore.getState().setDraft(project.project_id, id, draft)
    useNodeDraftStore.getState().setDraft('other-project', id, otherDraft)
    useProjectStore.getState().openProject(project, 'local')
    const { result } = renderHook(() => useBuilderActions(vi.fn()))
    await act(async () => { await result.current.handleHotspotUpdate({ ...project.nodes[id].hotspots[0], label: 'Changed image topic' }) })
    expect(useNodeDraftStore.getState().drafts[project.project_id][id]).toEqual({ ...draft,
      content_metadata: { ...draft.content_metadata, review_status: 'unreviewed' },
    })
    expect(useNodeDraftStore.getState().drafts['other-project'][id]).toBe(otherDraft)
    render(<NodeContentEditor projectId={project.project_id} node={useProjectStore.getState().project!.nodes[id]} local onSave={(patch) => result.current.handleNodeUpdate(id, patch)} />)
    expect(screen.getByRole('checkbox', { name: '我已人工核对页面内容和参考资料' })).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '保存页面内容' }))
    await waitFor(() => expect(useNodeDraftStore.getState().drafts[project.project_id]?.[id]).toBeUndefined())
    expect(useProjectStore.getState().project?.nodes[id].content_metadata?.review_status).toBe('unreviewed')
    expect(useProjectStore.getState().project?.nodes[id].description).toBe(draft.description)
    expect(useProjectStore.getState().project?.nodes[id].content_metadata?.provenance).toEqual(draft.content_metadata.provenance)
    expect(useProjectStore.getState().project?.nodes[id].content_metadata?.references).toEqual(draft.content_metadata.references)
    expect(useNodeDraftStore.getState().drafts['other-project'][id]).toBe(otherDraft)
  })
})
