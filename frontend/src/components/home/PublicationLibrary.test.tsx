import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PublicationLibrary } from './PublicationLibrary'
import { ProjectList } from './ProjectList'
import { api } from '../../api/client'
import { ConfirmHost } from '../shared/ConfirmDialog'
import { useI18nStore } from '../../i18n'
import { useProjectStore } from '../../store/projectStore'
import { useLibraryStore } from '../../store/libraryStore'
import { useNodeDraftStore } from '../../store/nodeDraftStore'
import type { Publication, PublicationList } from '../../types/publications'

vi.mock('../../api/client', () => ({ api: { listAllPublications: vi.fn(), withdrawPublication: vi.fn(), listProjects: vi.fn(), deleteProject: vi.fn() } }))

const published: Publication = { id: 'publication-one', project_id: 'deleted-source', name: '删除原稿后保留的水循环', source_revision: 6, page_count: 3, content_hash: 'b'.repeat(64), created_at: '2026-10-19T02:00:00Z', state: 'published', url: 'https://reader.example/p/publication-one/' }
const withdrawn: Publication = { ...published, state: 'withdrawn' }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

describe('global publication library', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useI18nStore.setState({ locale: 'zh' })
    useProjectStore.setState({ project: null, origin: 'server', analyzing: false, generating: false })
    useLibraryStore.setState({ projects: {} })
    useNodeDraftStore.setState({ drafts: {} })
    vi.mocked(api.listAllPublications).mockResolvedValue({ publications: [published] })
    vi.mocked(api.withdrawPublication).mockResolvedValue({ publication: withdrawn })
    vi.mocked(api.listProjects).mockResolvedValue({ projects: [] })
    vi.mocked(api.deleteProject).mockResolvedValue({ ok: true })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('loads independent receipts without an active source project and offers fixed reader actions', async () => {
    render(<PublicationLibrary onClose={vi.fn()} />)
    expect(await screen.findByText(published.name)).toBeInTheDocument()
    expect(api.listAllPublications).toHaveBeenCalledOnce()
    expect(useProjectStore.getState().project).toBeNull()
    expect(screen.getByText(/删除原作品后，已发布版本仍保留/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '打开只读版本' })).toHaveAttribute('href', published.url)
    fireEvent.click(screen.getByRole('button', { name: '复制链接' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(published.url))
    expect(await screen.findByText('固定版本链接已复制。')).toBeInTheDocument()
  })

  it('keeps withdrawal available after deleting the source and updates only that receipt', async () => {
    render(<><PublicationLibrary onClose={vi.fn()} /><ConfirmHost /></>)
    fireEvent.click(await screen.findByRole('button', { name: '撤下' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('读者已经下载的内容无法追回')
    fireEvent.click(screen.getByRole('button', { name: '撤下此版本' }))
    await waitFor(() => expect(api.withdrawPublication).toHaveBeenCalledWith('deleted-source', 'publication-one'))
    expect(await screen.findByText('此版本已撤下，原链接已失效。')).toBeInTheDocument()
    expect(screen.getByText('已撤下')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '撤下' })).not.toBeInTheDocument()
  })

  it('ignores a list request that arrives after a confirmed withdrawal', async () => {
    const stale = deferred<PublicationList>()
    vi.mocked(api.listAllPublications).mockResolvedValueOnce({ publications: [published] }).mockReturnValueOnce(stale.promise)
    render(<><PublicationLibrary onClose={vi.fn()} /><ConfirmHost /></>)
    await screen.findByText(published.name)
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    fireEvent.click(screen.getByRole('button', { name: '撤下' }))
    fireEvent.click(screen.getByRole('button', { name: '撤下此版本' }))
    await screen.findByText('已撤下')
    await act(async () => stale.resolve({ publications: [published] }))
    expect(screen.getByText('已撤下')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('shows load failures and retries into a useful empty state', async () => {
    vi.mocked(api.listAllPublications).mockRejectedValueOnce(new Error('连接发布记录失败。')).mockResolvedValueOnce({ publications: [] })
    render(<PublicationLibrary onClose={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('连接发布记录失败。')
    fireEvent.click(screen.getByRole('button', { name: '重新查询发布记录' }))
    expect(await screen.findByText(/此实例还没有发布记录/)).toBeInTheDocument()
    expect(api.listAllPublications).toHaveBeenCalledTimes(2)
  })

  it('keeps the receipt and offers reload after a failed withdrawal', async () => {
    vi.mocked(api.withdrawPublication).mockRejectedValueOnce(new Error('撤下响应中断，请重新查询。'))
    render(<><PublicationLibrary onClose={vi.fn()} /><ConfirmHost /></>)
    fireEvent.click(await screen.findByRole('button', { name: '撤下' }))
    fireEvent.click(screen.getByRole('button', { name: '撤下此版本' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('撤下响应中断')
    expect(screen.getByRole('button', { name: '撤下' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '重新查询发布记录' })).toBeInTheDocument()
  })

  it('does not submit a withdrawal after its panel was closed during confirmation', async () => {
    const view = render(<><PublicationLibrary onClose={vi.fn()} /><ConfirmHost /></>)
    fireEvent.click(await screen.findByRole('button', { name: '撤下' }))
    view.rerender(<ConfirmHost />)
    fireEvent.click(screen.getByRole('button', { name: '撤下此版本' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(api.withdrawPublication).not.toHaveBeenCalled()
  })

  it('does not adopt the previous panel response after closing and reopening', async () => {
    const stale = deferred<PublicationList>()
    vi.mocked(api.listAllPublications).mockReturnValueOnce(stale.promise).mockResolvedValueOnce({ publications: [] })
    const first = render(<PublicationLibrary onClose={vi.fn()} />)
    first.unmount()
    render(<PublicationLibrary onClose={vi.fn()} />)
    await screen.findByText(/此实例还没有发布记录/)
    await act(async () => stale.resolve({ publications: [published] }))
    expect(screen.queryByText(published.name)).not.toBeInTheDocument()
  })

  it('provides English reader actions and a selectable manual copy fallback', async () => {
    useI18nStore.setState({ locale: 'en' })
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('clipboard unavailable'))
    render(<PublicationLibrary onClose={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Published versions' })).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Copy link' }))
    expect(await screen.findByRole('textbox', { name: 'Copy this fixed version address manually:' })).toHaveValue(published.url)
    expect(screen.getByText('Source revision 6 · 3 pages')).toBeInTheDocument()
  })

  it('opens beside the home library even when the source list is empty and restores trigger focus', async () => {
    render(<ProjectList />)
    const trigger = screen.getByRole('button', { name: '发布记录' })
    fireEvent.click(trigger)
    await waitFor(() => expect(screen.getByRole('heading', { name: '发布记录' })).toHaveFocus())
    await screen.findByText(published.name)
    fireEvent.keyDown(screen.getByRole('region', { name: '发布记录' }), { key: 'Escape' })
    expect(screen.queryByRole('region', { name: '发布记录' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('explains preserved publications before deleting a server project', async () => {
    vi.mocked(api.listProjects).mockResolvedValue({ projects: [{ project_id: 'source', name: '原稿', thumbnail: null, root_title: '第一页', node_count: 3, created_at: null, updated_at: null }] })
    render(<><ProjectList /><ConfirmHost /></>)
    fireEvent.click(await screen.findByRole('button', { name: '删除 原稿' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('已发布的固定版本会保留，可从发布记录单独撤下')
    fireEvent.click(screen.getByRole('button', { name: '删除作品' }))
    await waitFor(() => expect(api.deleteProject).toHaveBeenCalledWith('source'))
    expect(screen.getByRole('button', { name: '发布记录' })).toBeInTheDocument()
  })
})
