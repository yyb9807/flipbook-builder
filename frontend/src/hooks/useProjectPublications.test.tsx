import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createManualProject } from '../data/exampleProject'
import { useGenerationJobStore } from '../store/generationJobStore'
import { useNodeDraftStore } from '../store/nodeDraftStore'
import { useProjectStore } from '../store/projectStore'
import type { Project } from '../types'
import type { Publication } from '../types/publications'
import { useProjectPublications } from './useProjectPublications'
import { acquireHistoryRestore, enqueueMutation, releaseHistoryRestore, resetProjectMutations, setMutationFailed } from './workspaceMutationQueue'

vi.mock('../api/client', () => ({ api: { listPublications: vi.fn(), createPublication: vi.fn(), withdrawPublication: vi.fn() } }))
import { api } from '../api/client'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}
function server(): Project {
  const project = { ...createManualProject('Publication', 'en'), revision: 4 }
  useProjectStore.getState().openProject(project, 'server')
  useGenerationJobStore.getState().setDiscovery(project.project_id, 'ready')
  return project
}
function receipt(project: Project): Publication {
  return { id: 'fixed-version', project_id: project.project_id, name: project.name, source_revision: 4,
    created_at: '2026-10-19T00:00:00Z', page_count: 1, content_hash: 'a'.repeat(64), state: 'published', url: 'http://localhost:8081/p/fixed-version/' }
}
beforeEach(() => {
  vi.restoreAllMocks(); vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear()
  const pid = useProjectStore.getState().project?.project_id
  if (pid) { resetProjectMutations(pid); releaseHistoryRestore(pid) }
  useProjectStore.getState().resetProject()
  useNodeDraftStore.setState({ drafts: {} })
  useGenerationJobStore.setState({ jobs: {}, pending: {}, references: {}, discovery: {}, syncing: {}, submitting: {} })
  vi.mocked(api.listPublications).mockResolvedValue({ publications: [] })
})
afterEach(cleanup)

describe('fixed publication operations', () => {
  it('publishes only the canonical revision and blocks same-tick duplicate requests', async () => {
    const project = server()
    const request = deferred<{ publication: Publication }>()
    vi.mocked(api.createPublication).mockReturnValue(request.promise)
    const { result } = renderHook(() => useProjectPublications())
    let first!: Promise<Publication | null>
    await act(async () => {
      first = result.current.publish()
      expect(await result.current.publish()).toBeNull()
    })
    expect(api.createPublication).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.createPublication).mock.calls[0]).toEqual([project.project_id, expect.any(String), 4])
    await act(async () => { request.resolve({ publication: receipt(project) }); expect(await first).toEqual(receipt(project)) })
    expect(result.current.publications).toEqual([receipt(project)])
    expect(result.current.uncertain).toBe(false)
    expect(sessionStorage.getItem(`flipbook-publication-operation:${project.project_id}`)).toBeNull()
  })

  it('checks drafts synchronously, including drafts on another page added in the same tick', async () => {
    const project = server()
    const { result } = renderHook(() => useProjectPublications())
    await act(async () => {
      useNodeDraftStore.getState().setDraft(project.project_id, 'another-page', { title: 'Unsent', description: '', scene_document: null })
      expect(await result.current.publish()).toBeNull()
    })
    expect(api.createPublication).not.toHaveBeenCalled()
  })

  it('refuses pending saves, failed saves, restoration and undiscovered generation before contacting the publication API', async () => {
    const project = server()
    const { result } = renderHook(() => useProjectPublications())
    const hold = deferred<void>()
    let saving!: Promise<void>
    act(() => { saving = enqueueMutation(`${project.project_id}/authoring`, () => hold.promise) })
    expect(result.current.blockReason).not.toBeNull()
    await act(async () => { expect(await result.current.publish()).toBeNull() })
    await act(async () => { hold.resolve(); await saving })
    expect(result.current.blockReason).toBeNull()
    setMutationFailed(project.project_id, 'page', true)
    await act(async () => { expect(await result.current.publish()).toBeNull() })
    setMutationFailed(project.project_id, 'page', false)
    expect(acquireHistoryRestore(project.project_id)).toBe(true)
    await act(async () => { expect(await result.current.publish()).toBeNull() })
    releaseHistoryRestore(project.project_id)
    await act(async () => {
      useGenerationJobStore.getState().setDiscovery(project.project_id, 'loading')
      expect(await result.current.publish()).toBeNull()
    })
    expect(api.createPublication).not.toHaveBeenCalled()
  })

  it('keeps an unknown request across panel remounts and retries its original operation and revision after further edits', async () => {
    const project = server()
    vi.mocked(api.createPublication).mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce({ publication: receipt(project) })
    const first = renderHook(() => useProjectPublications())
    await act(async () => { expect(await first.result.current.publish()).toBeNull() })
    expect(first.result.current.uncertain).toBe(true)
    first.unmount()
    useProjectStore.setState({ project: { ...project, revision: 8 } })
    const retry = renderHook(() => useProjectPublications())
    await waitFor(() => expect(retry.result.current.uncertain).toBe(true))
    await act(async () => { expect(await retry.result.current.publish()).toBeNull() })
    expect(api.createPublication).toHaveBeenCalledTimes(1)
    await act(async () => { expect(await retry.result.current.retry()).toEqual(receipt(project)) })
    expect(vi.mocked(api.createPublication).mock.calls[1]).toEqual(vi.mocked(api.createPublication).mock.calls[0])
    expect(useProjectStore.getState().project?.revision).toBe(8)
  })

  it('treats proxy/server failures as uncertain instead of silently starting a second publication', async () => {
    const project = server()
    vi.mocked(api.createPublication).mockRejectedValue(Object.assign(new Error('gateway'), { status: 502 }))
    const { result } = renderHook(() => useProjectPublications())
    await act(async () => { await result.current.publish() })
    expect(result.current.uncertain).toBe(true)
    await act(async () => { await result.current.publish() })
    expect(api.createPublication).toHaveBeenCalledTimes(1)
    expect(JSON.parse(sessionStorage.getItem(`flipbook-publication-operation:${project.project_id}`)!)).toMatchObject({ expected_revision: 4 })
  })

  it('retains the same publication across a lost response, an in-flight busy response and panel remounts', async () => {
    const project = server()
    vi.mocked(api.createPublication)
      .mockRejectedValueOnce(new Error('response lost while publishing'))
      .mockRejectedValueOnce(Object.assign(new Error('Publication is still being prepared; retry later.'), { status: 503 }))
      .mockResolvedValueOnce({ publication: receipt(project) })
    const first = renderHook(() => useProjectPublications())
    await act(async () => { expect(await first.result.current.publish()).toBeNull() })
    const original = sessionStorage.getItem(`flipbook-publication-operation:${project.project_id}`)
    expect(original).not.toBeNull()
    first.unmount()

    useProjectStore.setState({ project: { ...project, revision: 9 } })
    const busyRetry = renderHook(() => useProjectPublications())
    await waitFor(() => expect(busyRetry.result.current.uncertain).toBe(true))
    await act(async () => { expect(await busyRetry.result.current.retry()).toBeNull() })
    expect(busyRetry.result.current.uncertain).toBe(true)
    expect(busyRetry.result.current.error).toContain('still being prepared')
    expect(sessionStorage.getItem(`flipbook-publication-operation:${project.project_id}`)).toBe(original)
    busyRetry.unmount()

    const completedRetry = renderHook(() => useProjectPublications())
    await waitFor(() => expect(completedRetry.result.current.uncertain).toBe(true))
    await act(async () => { expect(await completedRetry.result.current.publish()).toBeNull() })
    expect(api.createPublication).toHaveBeenCalledTimes(2)
    await act(async () => { expect(await completedRetry.result.current.retry()).toEqual(receipt(project)) })
    const calls = vi.mocked(api.createPublication).mock.calls
    expect(calls[1]).toEqual(calls[0])
    expect(calls[2]).toEqual(calls[0])
    expect(calls[2][2]).toBe(4)
    expect(useProjectStore.getState().project?.revision).toBe(9)
    expect(completedRetry.result.current.uncertain).toBe(false)
    expect(completedRetry.result.current.publications).toEqual([receipt(project)])
    expect(sessionStorage.getItem(`flipbook-publication-operation:${project.project_id}`)).toBeNull()
  })

  it('does not replace a stale author revision or automatically republish after a conflict', async () => {
    const project = server()
    vi.mocked(api.createPublication).mockRejectedValueOnce(Object.assign(new Error('changed'), { status: 409 })).mockResolvedValueOnce({ publication: { ...receipt(project), source_revision: 9 } })
    const { result } = renderHook(() => useProjectPublications())
    await act(async () => { await result.current.publish() })
    expect(result.current.uncertain).toBe(false)
    expect(useProjectStore.getState().project?.revision).toBe(4)
    expect(api.createPublication).toHaveBeenCalledTimes(1)
    await act(async () => { useProjectStore.getState().adoptCommittedProject({ ...project, revision: 9 }) })
    await act(async () => { await result.current.publish() })
    const [first, second] = vi.mocked(api.createPublication).mock.calls
    expect(second[1]).not.toBe(first[1])
    expect(second[2]).toBe(9)
  })

  it('keeps another workspace untouched when a previous project publishes late', async () => {
    const original = server()
    const request = deferred<{ publication: Publication }>()
    vi.mocked(api.createPublication).mockReturnValue(request.promise)
    const { result } = renderHook(() => useProjectPublications())
    let pending!: Promise<Publication | null>
    await act(async () => { pending = result.current.publish() })
    let another!: Project
    await act(async () => { another = server() })
    await act(async () => { request.resolve({ publication: receipt(original) }); expect(await pending).toBeNull() })
    expect(result.current.publications).toEqual([])
    expect(useProjectStore.getState().project?.project_id).toBe(another.project_id)
  })

  it('ignores a list response that predates a newly created publication', async () => {
    const project = server()
    const list = deferred<{ publications: Publication[] }>()
    vi.mocked(api.listPublications).mockReturnValueOnce(list.promise)
    vi.mocked(api.createPublication).mockResolvedValueOnce({ publication: receipt(project) })
    const { result } = renderHook(() => useProjectPublications())
    await act(async () => { await result.current.publish() })
    await act(async () => { list.resolve({ publications: [] }); await list.promise })
    expect(result.current.publications).toEqual([receipt(project)])
    expect(result.current.loading).toBe(false)
  })

  it('reloads the list when the same project is reopened and ignores the previous workspace response', async () => {
    const project = server()
    const previous = deferred<{ publications: Publication[] }>()
    vi.mocked(api.listPublications).mockReturnValueOnce(previous.promise).mockResolvedValueOnce({ publications: [receipt(project)] })
    const { result } = renderHook(() => useProjectPublications())
    const oldPublish = result.current.publish
    await act(async () => {
      useProjectStore.getState().openProject({ ...project, revision: 8 }, 'server')
      useGenerationJobStore.getState().setDiscovery(project.project_id, 'ready')
      expect(await oldPublish()).toBeNull()
    })
    await waitFor(() => expect(result.current.publications).toEqual([receipt(project)]))
    await act(async () => { previous.resolve({ publications: [] }); await previous.promise })
    expect(result.current.publications).toEqual([receipt(project)])
    expect(result.current.loading).toBe(false)
    expect(api.createPublication).not.toHaveBeenCalled()
    expect(api.listPublications).toHaveBeenCalledTimes(2)
  })

  it('makes no request when the operation cannot be retained and allows publishing after storage recovers', async () => {
    const project = server()
    vi.mocked(api.createPublication).mockResolvedValue({ publication: receipt(project) })
    const { result } = renderHook(() => useProjectPublications())
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    await act(async () => { expect(await result.current.publish()).toBeNull() })
    expect(api.createPublication).not.toHaveBeenCalled()
    storage.mockRestore()
    await act(async () => { expect(await result.current.publish()).toEqual(receipt(project)) })
  })

  it('allows withdrawing a fixed publication while the author keeps an unrelated page draft', async () => {
    const project = server()
    const published = receipt(project)
    vi.mocked(api.listPublications).mockResolvedValue({ publications: [published] })
    vi.mocked(api.withdrawPublication).mockResolvedValue({ publication: { ...published, state: 'withdrawn' } })
    const { result } = renderHook(() => useProjectPublications())
    await waitFor(() => expect(result.current.publications).toHaveLength(1))
    await act(async () => { useNodeDraftStore.getState().setDraft(project.project_id, project.root_node_id!, { title: 'Keep me', description: '', scene_document: null }) })
    await act(async () => { expect(await result.current.withdraw(published.id)).toBe(true) })
    expect(result.current.publications[0].state).toBe('withdrawn')
    expect(useNodeDraftStore.getState().drafts[project.project_id][project.root_node_id!].title).toBe('Keep me')
  })

  it('does not publish local works or fetch their publications', async () => {
    const project = createManualProject('Local', 'en')
    useProjectStore.getState().openProject(project, 'local')
    const { result } = renderHook(() => useProjectPublications())
    await act(async () => { expect(await result.current.publish()).toBeNull() })
    expect(api.listPublications).not.toHaveBeenCalled()
    expect(api.createPublication).not.toHaveBeenCalled()
  })
})
