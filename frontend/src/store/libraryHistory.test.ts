import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createManualProject } from '../data/exampleProject'
import { useLibraryStore } from './libraryStore'
import { useProjectStore } from './projectStore'

beforeEach(() => { localStorage.clear(); useLibraryStore.setState({ projects: {}, storageError: false, storageConflict: false }); useProjectStore.getState().resetProject(); vi.restoreAllMocks() })

describe('atomic local library history', () => {
  it('keeps at most 50 complete content versions without copying illustration data', () => {
    const project = createManualProject('Page', 'en')
    const id = project.root_node_id!
    project.nodes[id].image_url = 'data:image/png;base64,one-image-only'
    useProjectStore.getState().openProject(project, 'local')
    for (let index = 0; index < 55; index++) expect(useProjectStore.getState().updateNode(id, { title: `Edit ${index}` })).toBe(true)
    const entry = useLibraryStore.getState().projects[project.project_id]
    expect(entry.versions![id]).toHaveLength(50)
    expect(entry.versions![id][0].sequence).toBe(56)
    expect(entry.versions![id].filter((version) => version.is_current)).toHaveLength(1)
    expect(localStorage.getItem('flipbook-library')!.split('one-image-only')).toHaveLength(2)
  })

  it('rejects a quota failure before replacing the saved project or pruning any history', () => {
    const project = createManualProject('Durable', 'en')
    const id = project.root_node_id!
    useProjectStore.getState().openProject(project, 'local')
    const before = localStorage.getItem('flipbook-library')
    const entry = useLibraryStore.getState().projects[project.project_id]
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError') })
    expect(useProjectStore.getState().updateNode(id, { title: 'Must not erase saved content' })).toBe(false)
    expect(useProjectStore.getState().project?.nodes[id].title).toBe('Durable')
    expect(useLibraryStore.getState().projects[project.project_id]).toBe(entry)
    expect(localStorage.getItem('flipbook-library')).toBe(before)
    expect(useLibraryStore.getState().storageError).toBe(true)
    spy.mockRestore()
  })

  it('rejects stale same-project writes and preserves another tab’s project and versions', () => {
    const project = createManualProject('Original', 'en')
    const id = project.root_node_id!
    useProjectStore.getState().openProject(project, 'local')
    const disk = JSON.parse(localStorage.getItem('flipbook-library')!)
    disk.state.projects[project.project_id].project.revision += 1
    disk.state.projects[project.project_id].project.nodes[id].title = 'Other tab saved this'
    localStorage.setItem('flipbook-library', JSON.stringify(disk))
    expect(useProjectStore.getState().updateNode(id, { title: 'Stale tab' })).toBe(false)
    expect(useLibraryStore.getState().storageConflict).toBe(true)
    expect(JSON.parse(localStorage.getItem('flipbook-library')!).state.projects[project.project_id].project.nodes[id].title).toBe('Other tab saved this')
    expect(useProjectStore.getState().project?.nodes[id].title).toBe('Original')
  })

  it('merges unrelated projects written by another tab instead of replacing the whole library', () => {
    const first = createManualProject('First', 'en')
    const second = createManualProject('Second', 'en')
    useProjectStore.getState().openProject(first, 'local')
    const disk = JSON.parse(localStorage.getItem('flipbook-library')!)
    disk.state.projects[second.project_id] = { project: second, updatedAt: '2026-10-19' }
    localStorage.setItem('flipbook-library', JSON.stringify(disk))
    expect(useProjectStore.getState().updateNode(first.root_node_id!, { title: 'First edited' })).toBe(true)
    expect(useLibraryStore.getState().projects[second.project_id].project).toEqual(second)
  })
})
