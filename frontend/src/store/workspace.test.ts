import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProjectStore } from './projectStore'
import { useLibraryStore } from './libraryStore'
import { useCreationStore } from './creationStore'
import { createExampleProject, createManualProject } from '../data/exampleProject'

vi.mock('../api/client', () => ({ api: { getProject: vi.fn() } }))
import { api } from '../api/client'

beforeEach(() => {
  localStorage.clear()
  useProjectStore.getState().resetProject()
  useLibraryStore.setState({ projects: {}, storageError: false })
  useCreationStore.getState().clear()
  vi.clearAllMocks()
})

describe('local authoring workspace', () => {
  it('browses examples without silently adding a project to the local library', () => {
    const example = createExampleProject()
    useProjectStore.getState().openProject(example, 'example', 'viewer')
    expect(useLibraryStore.getState().projects[example.project_id]).toBeUndefined()
    expect(useProjectStore.getState().origin).toBe('example')
  })
  it('opens an example locally, keeps edits, and restores without calling an API', async () => {
    const project = createExampleProject('zh')
    useProjectStore.getState().openProject(project, 'local', 'viewer')
    const root = project.root_node_id!
    useProjectStore.getState().updateNode(root, { title: '我的水循环' })
    expect(useLibraryStore.getState().projects[project.project_id].project.nodes[root].title).toBe('我的水循环')
    const persisted = localStorage.getItem('flipbook-project')!
    useProjectStore.setState({ project: null })
    localStorage.setItem('flipbook-project', persisted)
    await useProjectStore.persist.rehydrate()
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(useProjectStore.getState().project?.nodes[root].title).toBe('我的水循环')
    expect(useProjectStore.getState().origin).toBe('local')
    expect(api.getProject).not.toHaveBeenCalled()
  })

  it('navigates by ancestry rather than appending unrelated or repeated branches', () => {
    const project = createExampleProject()
    const [first, second] = project.nodes[project.root_node_id!].children
    useProjectStore.getState().openProject(project, 'local')
    useProjectStore.getState().navigateInto(first)
    useProjectStore.getState().navigateInto(first)
    expect(useProjectStore.getState().navigationStack).toEqual([project.root_node_id, first])
    useProjectStore.getState().navigateInto(second)
    expect(useProjectStore.getState().navigationStack).toEqual([project.root_node_id, second])
    useProjectStore.getState().navigateTo('missing')
    expect(useProjectStore.getState().activeNodeId).toBe(second)
    useProjectStore.getState().resetProject()
    expect(useProjectStore.getState().mode).toBe('builder')
  })

  it('persists text drafts but never serializes uploaded file contents', () => {
    const draft = useCreationStore.getState()
    draft.setTopic('城市水循环')
    draft.setFile(new File(['private image'], 'private.png', { type: 'image/png' }))
    const saved = localStorage.getItem('flipbook-creation')!
    expect(saved).toContain('城市水循环')
    expect(saved).not.toContain('private')
    expect(JSON.parse(saved).state.file).toBeUndefined()
  })

  it('manual pages have editable content without claiming AI generation', () => {
    const project = createManualProject('咖啡的旅程', 'zh')
    const root = project.nodes[project.root_node_id!]
    expect(root.scene_document?.version).toBe(1)
    expect(root.scene_document?.sections[0].body).toBe('')
    expect(root.image_url).toBeNull()
    expect(root.status).toBe('completed')
  })
})
