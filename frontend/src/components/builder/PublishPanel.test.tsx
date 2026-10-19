import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PublishPanel } from './PublishPanel'
import { ProjectActions } from './ProjectActions'
import { useProjectStore } from '../../store/projectStore'
import { useNodeDraftStore } from '../../store/nodeDraftStore'
import { useI18nStore } from '../../i18n'
import { useProjectPublications } from '../../hooks/useProjectPublications'
import { ConfirmHost } from '../shared/ConfirmDialog'
import type { Publication } from '../../types/publications'
import type { Project } from '../../types'

vi.mock('../../hooks/useProjectPublications', () => ({ useProjectPublications: vi.fn() }))

const project: Project = {
  project_id: 'project-one', name: '水循环知识图册', revision: 5, root_node_id: 'root',
  settings: { max_depth: 4, max_hotspots_per_page: 3, visual_style: 'atlas', language: 'zh' }, nodes: {},
}
const publication: Publication = { id: 'fixed-one', project_id: project.project_id, name: '最初发布的水循环', source_revision: 4, created_at: '2026-10-19T01:00:00Z', page_count: 3, content_hash: 'a'.repeat(64), state: 'published', url: 'https://reader.example/p/fixed-one/' }

function controller(overrides: Partial<ReturnType<typeof useProjectPublications>> = {}) {
  return { publications: [] as Publication[], loading: false, busy: false, error: null, uncertain: false, blockReason: null, publish: vi.fn().mockResolvedValue(publication), retry: vi.fn().mockResolvedValue(publication), withdraw: vi.fn().mockResolvedValue(true), reload: vi.fn().mockResolvedValue(undefined), ...overrides }
}

describe('fixed publication authoring panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({ project, origin: 'server', analyzing: false, generating: false })
    useNodeDraftStore.setState({ drafts: {} })
    useI18nStore.setState({ locale: 'zh' })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
    vi.mocked(useProjectPublications).mockReturnValue(controller())
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('opens from the server menu, moves focus, and returns to its trigger on Escape', async () => {
    render(<ProjectActions />)
    const trigger = screen.getByRole('button', { name: '导出与分享' })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /发布固定版本/ }))
    const region = screen.getByRole('region', { name: '发布固定版本' })
    expect(region).not.toHaveAttribute('aria-modal')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('heading', { name: '发布固定版本' })).toHaveFocus())
    fireEvent.keyDown(region, { key: 'Escape' })
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('publishes only saved content and explains the independent reader and link scope', async () => {
    const state = controller()
    vi.mocked(useProjectPublications).mockReturnValue(state)
    render(<PublishPanel onClose={vi.fn()} />)
    expect(screen.getByText(/任何获得固定链接的人都能阅读/)).toBeInTheDocument()
    expect(screen.getByText(/当前保存修订 5/)).toBeInTheDocument()
    expect(screen.getByText(/还没有固定版本/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '发布当前保存版本' }))
    await waitFor(() => expect(state.publish).toHaveBeenCalledOnce())
    expect(await screen.findByText(/固定版本已发布。继续编辑不会改变/)).toBeInTheDocument()
  })

  it('keeps old versions visible, distinguishes newer edits, and uses fixed reader addresses', async () => {
    vi.mocked(useProjectPublications).mockReturnValue(controller({ publications: [publication, { ...publication, id: 'fixed-old', state: 'withdrawn' }] }))
    render(<PublishPanel onClose={vi.fn()} />)
    expect(screen.getByText(/有更新的已保存内容尚未发布/)).toBeInTheDocument()
    expect(screen.getAllByText('源修订 4 · 3 页')).toHaveLength(2)
    expect(screen.getByRole('link', { name: '打开只读版本' })).toHaveAttribute('href', publication.url)
    expect(screen.getByRole('link', { name: '打开只读版本' })).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByText('原链接已失效，无法重新启用。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '复制链接' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(publication.url))
    expect(await screen.findByText('固定版本链接已复制。')).toBeInTheDocument()
  })

  it('shows a selectable fixed link when automatic copy fails', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('denied'))
    vi.mocked(useProjectPublications).mockReturnValue(controller({ publications: [publication] }))
    render(<PublishPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '复制链接' }))
    const address = await screen.findByRole('textbox', { name: /无法自动复制/ })
    expect(address).toHaveValue(publication.url)
    expect(address).toHaveAttribute('readonly')
  })

  it.each(['请先保存所有页面草稿。', '正在生成页面。', '有尚未完成的保存。', '正在恢复页面版本。'])('shows the reason and blocks publishing: %s', (blockReason) => {
    const state = controller({ blockReason })
    vi.mocked(useProjectPublications).mockReturnValue(state)
    render(<PublishPanel onClose={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent(blockReason)
    const publish = screen.getByRole('button', { name: '发布当前保存版本' })
    expect(publish).toBeDisabled()
    expect(publish).toHaveAttribute('aria-describedby', 'publication-blocked')
    fireEvent.click(publish)
    expect(state.publish).not.toHaveBeenCalled()
  })

  it('only retries the original uncertain operation and never starts a new publication', async () => {
    const state = controller({ uncertain: true, error: '服务器响应中断。' })
    vi.mocked(useProjectPublications).mockReturnValue(state)
    render(<PublishPanel onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '发布当前保存版本' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '查询并重试原发布' }))
    await waitFor(() => expect(state.retry).toHaveBeenCalledOnce())
    expect(state.publish).not.toHaveBeenCalled()
  })

  it('requires an explicit withdrawal confirmation, explaining downloaded copies', async () => {
    const state = controller({ publications: [publication] })
    const onClose = vi.fn()
    vi.mocked(useProjectPublications).mockReturnValue(state)
    render(<><PublishPanel onClose={onClose} /><ConfirmHost /></>)
    fireEvent.click(screen.getByRole('button', { name: '撤下' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('读者已经下载的内容无法追回')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(state.withdraw).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '撤下' }))
    fireEvent.click(screen.getByRole('button', { name: '撤下此版本' }))
    await waitFor(() => expect(state.withdraw).toHaveBeenCalledWith(publication.id))
    expect(await screen.findByText('此版本已撤下，原链接已失效。')).toBeInTheDocument()
  })

  it('does not describe an already withdrawn retry receipt as a published version', async () => {
    const state = controller({ uncertain: true, retry: vi.fn().mockResolvedValue({ ...publication, state: 'withdrawn' }) })
    vi.mocked(useProjectPublications).mockReturnValue(state)
    render(<PublishPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '查询并重试原发布' }))
    expect(await screen.findByText('原发布已确认，但此版本已撤下。核对当前内容后，可发布新版本。')).toBeInTheDocument()
    expect(screen.queryByText(/固定版本已发布。继续编辑/)).not.toBeInTheDocument()
  })

  it('shows saved content already published, reload errors, and English copy', async () => {
    const state = controller({ publications: [{ ...publication, source_revision: 5 }], error: 'Could not load publications.' })
    vi.mocked(useProjectPublications).mockReturnValue(state)
    useI18nStore.setState({ locale: 'en' })
    render(<PublishPanel onClose={vi.fn()} />)
    expect(screen.getByText(/The saved content already has a fixed version/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Publish a fixed version' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load publications.')
    fireEvent.click(screen.getByRole('button', { name: 'Reload publications' }))
    await waitFor(() => expect(state.reload).toHaveBeenCalledOnce())
  })

  it('does not offer server publication or preview for local browser work', () => {
    useProjectStore.setState({ origin: 'local' })
    render(<ProjectActions />)
    fireEvent.click(screen.getByRole('button', { name: '导出与分享' }))
    expect(screen.queryByRole('menuitem', { name: /发布固定版本/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /当前实例预览/ })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /导出离线 ZIP/ })).toBeInTheDocument()
  })
})
