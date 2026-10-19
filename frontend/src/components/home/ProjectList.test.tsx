import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ProjectList } from './ProjectList'
import { api } from '../../api/client'
import { createManualProject } from '../../data/exampleProject'
import { useLibraryStore } from '../../store/libraryStore'
import { useNodeDraftStore } from '../../store/nodeDraftStore'
import { useProjectStore } from '../../store/projectStore'
import { useI18nStore } from '../../i18n'
import { ConfirmHost } from '../shared/ConfirmDialog'
import { ToastHost } from '../shared/Toast'

beforeEach(() => {
  useI18nStore.setState({ locale: 'zh' })
  useProjectStore.getState().resetProject()
  useLibraryStore.setState({ projects: {}, storageError: false, storageConflict: false })
  useNodeDraftStore.setState({ drafts: {} })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function seedLibrary() {
  const local = createManualProject('本地森林', 'zh')
  useLibraryStore.setState({ projects: { [local.project_id]: { project: local, updatedAt: '2026-10-18T08:00:00Z' } } })
  vi.spyOn(api, 'listProjects').mockResolvedValue({ projects: [
    { project_id: 'new', name: 'Ocean notes', node_count: 3, thumbnail: null, root_title: null, created_at: null, updated_at: '2026-10-19T08:00:00Z' },
    { project_id: 'old', name: '较早的作品', node_count: 2, thumbnail: null, root_title: null, created_at: '2026-10-17T08:00:00Z', updated_at: null },
  ] })
  return local
}

function renderLibrary() { return render(<MemoryRouter><ProjectList /><ConfirmHost /><ToastHost /></MemoryRouter>) }

describe('project library discovery', () => {
  it('sorts browser and server projects together by update time and keeps location visible beside drafts', async () => {
    const local = seedLibrary()
    const node = local.nodes[local.root_node_id!]
    useNodeDraftStore.getState().setDraft(local.project_id, node.id, { title: '草稿', description: node.description, scene_document: node.scene_document ?? null, content_metadata: null })
    renderLibrary()
    await screen.findByRole('heading', { name: 'Ocean notes' })
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Ocean notes', '本地森林', '较早的作品'])
    const localCard = screen.getByRole('heading', { name: '本地森林' }).closest('article')!
    expect(within(localCard).getByText('此浏览器')).toBeVisible()
    expect(within(localCard).getByText('含草稿')).toBeVisible()
    expect(localCard.querySelector('time')).toHaveAttribute('dateTime', '2026-10-18T08:00:00Z')
    expect(screen.getByRole('heading', { name: '较早的作品' }).closest('article')!.querySelector('time')).toHaveAttribute('dateTime', '2026-10-17T08:00:00Z')
  })

  it('combines case-insensitive search and location filtering without fetching again, and recovers from no results', async () => {
    seedLibrary()
    renderLibrary()
    await screen.findByRole('heading', { name: 'Ocean notes' })
    fireEvent.change(screen.getByRole('searchbox', { name: '查找作品' }), { target: { value: ' oCeAn ' } })
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1)
    expect(screen.getByText('1 / 3 份作品')).toBeVisible()
    fireEvent.change(screen.getByRole('combobox', { name: '存储位置' }), { target: { value: 'local' } })
    expect(screen.getByText('没有找到匹配的作品')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }))
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(3)
    expect(screen.getByRole('searchbox', { name: '查找作品' })).toHaveValue('')
    expect(screen.getByRole('combobox', { name: '存储位置' })).toHaveValue('all')
    expect(api.listProjects).toHaveBeenCalledTimes(1)
  })

  it('keeps local projects searchable when the backend is unavailable', async () => {
    const local = seedLibrary()
    vi.mocked(api.listProjects).mockRejectedValue(new Error('offline'))
    renderLibrary()
    await screen.findByRole('button', { name: '重新连接' })
    fireEvent.change(screen.getByRole('searchbox', { name: '查找作品' }), { target: { value: '森林' } })
    fireEvent.click(screen.getByRole('heading', { name: '本地森林' }).closest('button')!)
    expect(useProjectStore.getState()).toMatchObject({ origin: 'local', project: { project_id: local.project_id } })
  })

  it('retains page drafts when browser storage rejects a project deletion', async () => {
    const local = seedLibrary()
    const node = local.nodes[local.root_node_id!]
    useNodeDraftStore.getState().setDraft(local.project_id, node.id, { title: '待保存', description: '', scene_document: node.scene_document ?? null, content_metadata: null })
    const remove = vi.spyOn(useLibraryStore.getState(), 'remove').mockReturnValue(false)
    renderLibrary()
    fireEvent.click(screen.getByRole('button', { name: '删除 本地森林' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '删除作品' }))
    await screen.findByText(/浏览器未能保存删除操作/)
    expect(remove).toHaveBeenCalledWith(local.project_id)
    expect(useNodeDraftStore.getState().drafts[local.project_id]![node.id].title).toBe('待保存')
    expect(screen.getByRole('heading', { name: '本地森林' })).toBeVisible()
  })

  it('uses singular and plural page labels in the English library', async () => {
    seedLibrary()
    useI18nStore.setState({ locale: 'en' })
    renderLibrary()
    await screen.findByRole('heading', { name: 'Ocean notes' })
    const onePage = screen.getByRole('heading', { name: '本地森林' }).closest('article')!
    const threePages = screen.getByRole('heading', { name: 'Ocean notes' }).closest('article')!
    expect(within(onePage).getByText('1 page')).toBeVisible()
    expect(within(onePage).queryByText('1 pages')).not.toBeInTheDocument()
    expect(within(threePages).getByText('3 pages')).toBeVisible()
  })

})
