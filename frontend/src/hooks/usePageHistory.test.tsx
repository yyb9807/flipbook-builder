import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePageHistory } from './usePageHistory'
import { useBuilderActions } from './useBuilderActions'
import { createManualProject } from '../data/exampleProject'
import { useProjectStore } from '../store/projectStore'
import { useLibraryStore } from '../store/libraryStore'
import { useNodeDraftStore } from '../store/nodeDraftStore'
import { useGenerationJobStore } from '../store/generationJobStore'
import { acquireHistoryRestore, hasFailedProjectMutations, releaseHistoryRestore, resetProjectMutations, setMutationFailed } from './workspaceMutationQueue'
import type { PageVersionList } from '../types/history'
import type { Project } from '../types'

vi.mock('../api/client', () => ({ api: { listPageVersions: vi.fn(), getPageVersion: vi.fn(), restorePageVersion: vi.fn(), getProject: vi.fn(), updateNode: vi.fn(), updateHotspots: vi.fn(), createHotspot: vi.fn() } }))
import { api } from '../api/client'
function versions(): PageVersionList {
  return { project_revision: 4, current_version_id: 'current', versions: [
    { id: 'current', sequence: 2, reason: 'edit', created_at: '2026-10-19T00:00:00Z', is_current: true, summary: { title: 'Now', description: '', section_count: 1, hotspot_count: 1 } },
    { id: 'before', sequence: 1, reason: 'initial', created_at: '2026-10-18T00:00:00Z', is_current: false, summary: { title: 'Before', description: '', section_count: 1, hotspot_count: 1 } },
  ] }
}
function openServer(): Project {
  const project = { ...createManualProject('Now', 'en'), revision: 4 }
  useProjectStore.getState().openProject(project, 'server')
  useGenerationJobStore.getState().setDiscovery(project.project_id, 'ready')
  return project
}
function receipt(project: Project) { return { project_revision: 5, node: { ...project.nodes[project.root_node_id!], title: 'Before' }, restored_version_id: 'restored', preserved_branch_count: 0 } }
beforeEach(() => {
  vi.restoreAllMocks(); vi.clearAllMocks(); localStorage.clear()
  const old = useProjectStore.getState().project?.project_id
  if (old) { resetProjectMutations(old); releaseHistoryRestore(old) }
  useProjectStore.getState().resetProject()
  useLibraryStore.setState({ projects: {}, storageError: false, storageConflict: false })
  useNodeDraftStore.setState({ drafts: {} })
  useGenerationJobStore.setState({ jobs: {}, pending: {}, references: {}, discovery: {}, syncing: {}, submitting: {} })
  vi.mocked(api.listPageVersions).mockResolvedValue(versions())
})
afterEach(cleanup)

describe('saved page restoration', () => {
  it('undoes and redoes local saved content by appending recovery versions', async () => {
    const project = createManualProject('Before', 'en')
    const id = project.root_node_id!
    useProjectStore.getState().openProject(project, 'local')
    useProjectStore.getState().updateNode(id, { title: 'After' })
    const { result } = renderHook(() => usePageHistory(vi.fn()))
    await waitFor(() => expect(result.current.versions).toHaveLength(2))
    await act(async () => { expect(await result.current.restoreVersion(result.current.versions[1].id)).toBe(true) })
    expect(useProjectStore.getState().project?.nodes[id].title).toBe('Before')
    await waitFor(() => expect(result.current.versions).toHaveLength(3))
    expect(result.current.versions[0].reason).toBe('restore')
    await act(async () => { expect(await result.current.restoreVersion(result.current.versions[1].id)).toBe(true) })
    expect(useProjectStore.getState().project?.nodes[id].title).toBe('After')
    expect(api.restorePageVersion).not.toHaveBeenCalled()
  })

  it('keeps the saved local page and history when a restore cannot be persisted', async () => {
    const project = createManualProject('Before', 'en')
    const id = project.root_node_id!
    useProjectStore.getState().openProject(project, 'local')
    useProjectStore.getState().updateNode(id, { title: 'After' })
    const { result } = renderHook(() => usePageHistory(vi.fn()))
    await waitFor(() => expect(result.current.versions).toHaveLength(2))
    const before = localStorage.getItem('flipbook-library')
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota') })
    await act(async () => { expect(await result.current.restoreVersion(result.current.versions[1].id)).toBe(false) })
    expect(useProjectStore.getState().project?.nodes[id].title).toBe('After')
    expect(result.current.versions).toHaveLength(2)
    expect(localStorage.getItem('flipbook-library')).toBe(before)
  })

  it('blocks restoring while any project page has a draft or a failed mutation', async () => {
    const project = openServer()
    const id = project.root_node_id!
    const { result } = renderHook(() => usePageHistory(vi.fn()))
    await waitFor(() => expect(result.current.versions).toHaveLength(2))
    useNodeDraftStore.getState().setDraft(project.project_id, 'another-page', { title: 'Draft', description: '', scene_document: null })
    await act(async () => { expect(await result.current.restoreVersion(result.current.versions[1].id)).toBe(false) })
    useNodeDraftStore.getState().removeProject(project.project_id)
    setMutationFailed(project.project_id, `node/${id}`, true)
    await act(async () => { expect(await result.current.restoreVersion(result.current.versions[1].id)).toBe(false) })
    expect(api.restorePageVersion).not.toHaveBeenCalled()
  })

  it('reuses the operation after an unknown network result and adopts canonical content after a replay', async () => {
    const project = openServer()
    const id = project.root_node_id!
    const canonical = { ...project, revision: 7, nodes: { ...project.nodes, [id]: { ...project.nodes[id], title: 'Another tab edited after the restore' } } }
    vi.mocked(api.restorePageVersion).mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce(receipt(project))
    vi.mocked(api.getProject).mockResolvedValue(canonical)
    const { result } = renderHook(() => usePageHistory(vi.fn()))
    await waitFor(() => expect(result.current.versions).toHaveLength(2))
    await act(async () => { expect(await result.current.restoreVersion(result.current.versions[1].id)).toBe(false) })
    await act(async () => { expect(await result.current.restoreVersion(result.current.versions[1].id)).toBe(true) })
    expect(vi.mocked(api.restorePageVersion).mock.calls[1]).toEqual(vi.mocked(api.restorePageVersion).mock.calls[0])
    expect(useProjectStore.getState().project?.nodes[id].title).toBe(canonical.nodes[id].title)
    expect(useProjectStore.getState().project?.revision).toBe(7)
  })

  it('does not upgrade stale author content from a history refresh, but explicitly reloads after a conflict', async () => {
    const project = openServer()
    const id = project.root_node_id!
    const conflict = Object.assign(new Error('project changed; reload'), { status: 409 })
    vi.mocked(api.restorePageVersion).mockRejectedValueOnce(conflict).mockResolvedValueOnce(receipt(project))
    vi.mocked(api.listPageVersions).mockResolvedValue({ ...versions(), project_revision: 9 })
    const canonical = { ...project, revision: 9, nodes: { ...project.nodes, [id]: { ...project.nodes[id], title: 'Other author' } } }
    vi.mocked(api.getProject).mockResolvedValue(canonical)
    const { result } = renderHook(() => usePageHistory(vi.fn()))
    await waitFor(() => expect(result.current.versions).toHaveLength(2))
    await act(async () => { await result.current.refresh(); expect(await result.current.restoreVersion(result.current.versions[1].id)).toBe(false) })
    expect(vi.mocked(api.restorePageVersion).mock.calls[0][4]).toBe(4)
    await act(async () => { expect(await result.current.reloadProject()).toBe(true) })
    await act(async () => { expect(await result.current.restoreVersion(result.current.versions[1].id)).toBe(true) })
    expect(vi.mocked(api.restorePageVersion).mock.calls[1][4]).toBe(9)
    expect(vi.mocked(api.restorePageVersion).mock.calls[1][3]).not.toBe(vi.mocked(api.restorePageVersion).mock.calls[0][3])
  })

  it('recovers failed author changes before explicit reload and prevents retrying the discarded request', async () => {
    const project = openServer()
    const id = project.root_node_id!
    vi.mocked(api.updateNode).mockRejectedValue(Object.assign(new Error('conflict'), { status: 409 }))
    vi.mocked(api.getProject).mockResolvedValue(project)
    const { result } = renderHook(() => ({ history: usePageHistory(vi.fn()), actions: useBuilderActions(vi.fn()) }))
    await act(async () => { expect(await result.current.actions.handleNodeUpdate(id, { title: 'Unsaved author work' })).toBe(false) })
    expect(hasFailedProjectMutations(project.project_id)).toBe(true)
    await act(async () => { expect(await result.current.history.reloadProject()).toBe(true) })
    expect(useLibraryStore.getState().projects[`local-recovery-${project.project_id}`].project.nodes[id].title).toBe('Unsaved author work')
    expect(useProjectStore.getState().project?.nodes[id].title).toBe('Now')
    expect(hasFailedProjectMutations(project.project_id)).toBe(false)
    expect(result.current.actions.saveStatus).toBe('saved')
    await act(async () => { await result.current.actions.retryPending() })
    expect(api.updateNode).toHaveBeenCalledTimes(1)
  })

  it('keeps a draft and refuses reloading while a page draft exists', async () => {
    const project = openServer()
    const id = project.root_node_id!
    const draft = { title: 'Keep this draft', description: '', scene_document: null }
    useNodeDraftStore.getState().setDraft(project.project_id, id, draft)
    const { result } = renderHook(() => usePageHistory(vi.fn()))
    await act(async () => { expect(await result.current.reloadProject()).toBe(false) })
    expect(api.getProject).not.toHaveBeenCalled()
    expect(useNodeDraftStore.getState().drafts[project.project_id][id]).toBe(draft)
  })

  it('does not discard failed author work if the browser cannot keep a recovery copy before reloading', async () => {
    const project = openServer()
    const id = project.root_node_id!
    setMutationFailed(project.project_id, `node/${id}`, true)
    const { result } = renderHook(() => usePageHistory(vi.fn()))
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota') })
    await act(async () => { expect(await result.current.reloadProject()).toBe(false) })
    expect(api.getProject).not.toHaveBeenCalled()
    expect(hasFailedProjectMutations(project.project_id)).toBe(true)
    expect(useProjectStore.getState().project?.nodes[id]).toBe(project.nodes[id])
  })

  it('explicitly loads another tab’s saved local project after a revision conflict', async () => {
    const project = createManualProject('Original local', 'en')
    const id = project.root_node_id!
    useProjectStore.getState().openProject(project, 'local')
    const disk = JSON.parse(localStorage.getItem('flipbook-library')!)
    disk.state.projects[project.project_id].project.nodes[id].title = 'Other tab local content'
    disk.state.projects[project.project_id].project.revision += 1
    localStorage.setItem('flipbook-library', JSON.stringify(disk))
    expect(useProjectStore.getState().updateNode(id, { title: 'Must not overwrite the other tab' })).toBe(false)
    const { result } = renderHook(() => usePageHistory(vi.fn()))
    await act(async () => { expect(await result.current.reloadProject()).toBe(true) })
    expect(useProjectStore.getState().project?.nodes[id].title).toBe('Other tab local content')
    expect(useLibraryStore.getState().storageConflict).toBe(false)
    expect(api.getProject).not.toHaveBeenCalled()
  })

  it('does not replace another workspace with a delayed server restoration', async () => {
    const project = openServer()
    let finish!: (value: ReturnType<typeof receipt>) => void
    vi.mocked(api.restorePageVersion).mockReturnValue(new Promise((resolve) => { finish = resolve }))
    vi.mocked(api.getProject).mockResolvedValue(project)
    const { result } = renderHook(() => usePageHistory(vi.fn()))
    await waitFor(() => expect(result.current.versions).toHaveLength(2))
    let restoring!: Promise<boolean>
    act(() => { restoring = result.current.restoreVersion(result.current.versions[1].id) })
    const other = createManualProject('Other workspace', 'en')
    act(() => useProjectStore.getState().openProject(other, 'local'))
    await act(async () => { finish(receipt(project)); expect(await restoring).toBe(true) })
    expect(useProjectStore.getState().project?.project_id).toBe(other.project_id)
    expect(useProjectStore.getState().origin).toBe('local')
  })

  it('guards every author action while a history restore holds the project lock', async () => {
    const project = openServer()
    const { result } = renderHook(() => useBuilderActions(vi.fn()))
    expect(acquireHistoryRestore(project.project_id)).toBe(true)
    await act(async () => { expect(await result.current.handleNodeUpdate(project.root_node_id!, { title: 'Blocked' })).toBe(false); await result.current.handleAddHotspot() })
    expect(api.updateNode).not.toHaveBeenCalled()
    expect(api.createHotspot).not.toHaveBeenCalled()
    releaseHistoryRestore(project.project_id)
  })
})
