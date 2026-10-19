import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PageHistoryPanel } from './PageHistoryPanel'
import type { PageHistoryController } from './PageHistoryPanel'
import { ConfirmHost } from '../shared/ConfirmDialog'
import { createManualProject } from '../../data/exampleProject'
import { useI18nStore } from '../../i18n'
import type { PageVersionDetail, PageVersionSummary } from '../../types/history'

beforeEach(() => useI18nStore.setState({ locale: 'zh' }))
afterEach(cleanup)

function fixture() {
  const project = createManualProject('恢复后的页面', 'zh')
  const node = project.nodes[project.root_node_id!]
  node.description = '历史版本的说明'
  node.scene_document = { version: 1, layout: 'atlas', sections: [{ id: 'old-section', title: '保留的要点', body: '恢复前可阅读的完整解释。', target_node_id: 'existing-child' }] }
  node.content_metadata = { version: 1, references: [{ id: 'ref', title: '一本参考书' }], review_status: 'unreviewed' }
  const current: PageVersionSummary = { id: 'current', sequence: 3, reason: 'edit', created_at: '2026-10-19T03:00:00Z', summary: { title: '当前标题', description: '', section_count: 1, hotspot_count: 1 }, is_current: true }
  const previous: PageVersionSummary = { ...current, id: 'previous', sequence: 2, is_current: false, summary: { ...current.summary, title: '之前标题' } }
  const detail: PageVersionDetail = { project_revision: 4, version: previous, preview: node, preserved_branch_count: 1 }
  const history: PageHistoryController = {
    versions: [current, previous], currentVersionId: 'current', loading: false, busy: false, error: null,
    refresh: vi.fn().mockResolvedValue(undefined), getVersion: vi.fn().mockResolvedValue(detail), restoreVersion: vi.fn().mockResolvedValue(true),
  }
  return { current, previous, detail, history }
}

describe('page version history', () => {
  it('previews actual restored text and retained branches without navigating or changing content', async () => {
    const { history } = fixture()
    render(<PageHistoryPanel history={history} local onEditContent={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /之前标题/ }))
    const preview = await screen.findByRole('region', { name: '恢复结果预览' })
    expect(within(preview).getByRole('heading', { name: '恢复后的页面' })).toBeVisible()
    expect(within(preview).getByText('恢复前可阅读的完整解释。')).toBeVisible()
    expect(within(preview).getByText('一本参考书')).toBeVisible()
    expect(within(preview).getByText('为保护已有分支，预览保留了 1 个较新的连接。')).toBeVisible()
    expect(within(preview).queryByRole('button', { name: '打开页面' })).not.toBeInTheDocument()
    expect(history.restoreVersion).not.toHaveBeenCalled()
  })

  it('keeps history readable while explaining why restoration is disabled', async () => {
    const { history } = fixture()
    render(<PageHistoryPanel history={history} disabledReason="作品中有未保存的页面草稿。" local={false} onEditContent={vi.fn()} />)
    expect(screen.getByRole('button', { name: '预览上一版本' })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent('未保存的页面草稿')
    fireEvent.click(screen.getByRole('button', { name: '预览上一版本' }))
    expect(await screen.findByRole('button', { name: '恢复此版本' })).toBeDisabled()
    expect(history.getVersion).toHaveBeenCalledWith('previous')
  })

  it('honors the list current marker even when the detailed record has a stale marker', async () => {
    const { history, detail, current } = fixture()
    history.currentVersionId = null
    history.getVersion = vi.fn().mockResolvedValue({ ...detail, version: { ...current, is_current: false } })
    render(<PageHistoryPanel history={history} local onEditContent={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /当前标题/ }))
    expect(await screen.findByRole('button', { name: '这是当前版本' })).toBeDisabled()
  })

  it('allows explicit reload after a failed save while keeping restore disabled', async () => {
    const { history } = fixture()
    history.reloadProject = vi.fn().mockResolvedValue(true)
    render(<PageHistoryPanel history={history} disabledReason="页面修改尚未成功保存。" reloadDisabledReason={null} synchronizationError="未保存修改已保留为恢复副本。" local={false} onEditContent={vi.fn()} />)
    expect(screen.getByRole('button', { name: '预览上一版本' })).toBeEnabled()
    const reload = screen.getByRole('button', { name: '重新载入已保存页面' })
    expect(reload).toBeEnabled()
    fireEvent.click(reload)
    await waitFor(() => expect(history.reloadProject).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('已载入最新保存的作品。请选择版本并重新查看恢复预览。')).toBeVisible()
  })

  it('shows the previous version preview before confirmation and supports cancel without a write', async () => {
    const { history } = fixture()
    render(<><PageHistoryPanel history={history} local onEditContent={vi.fn()} /><ConfirmHost /></>)
    fireEvent.click(screen.getByRole('button', { name: '预览上一版本' }))
    const preview = await screen.findByRole('region', { name: '恢复结果预览' })
    expect(within(preview).getByText('恢复前可阅读的完整解释。')).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(history.restoreVersion).not.toHaveBeenCalled()
    const restoreButton = within(preview).getByRole('button', { name: '恢复此版本' })
    restoreButton.focus()
    fireEvent.click(restoreButton)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('已有子页和分支关系会保留')
    expect(dialog).toHaveTextContent('恢复前的内容会保留在历史中')
    expect(dialog).toHaveTextContent('恢复后需要重新人工核对')
    expect(within(dialog).getByRole('button', { name: '取消' })).toHaveFocus()
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(history.restoreVersion).not.toHaveBeenCalled()
    expect(restoreButton).toHaveFocus()
    fireEvent.click(restoreButton)
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '恢复此版本' }))
    await waitFor(() => expect(history.restoreVersion).toHaveBeenCalledWith('previous'))
    expect(await screen.findByText('页面已恢复。恢复前的内容可在历史版本中找回。')).toBeVisible()
  })

  it('ignores an older detail response after the reader selects another version', async () => {
    const { history, detail, previous } = fixture()
    let finish!: (detail: PageVersionDetail) => void
    history.versions.push({ ...previous, id: 'older', summary: { ...previous.summary, title: '更早标题' } })
    history.getVersion = vi.fn().mockImplementationOnce(() => new Promise<PageVersionDetail>((resolve) => { finish = resolve })).mockResolvedValueOnce({ ...detail, version: { ...previous, id: 'older' }, preview: { ...detail.preview, title: '更早的预览' } })
    render(<PageHistoryPanel history={history} local onEditContent={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /之前标题/ }))
    fireEvent.click(screen.getByRole('button', { name: /更早标题/ }))
    await screen.findByRole('heading', { name: '更早的预览' })
    await act(async () => finish(detail))
    expect(screen.queryByRole('heading', { name: '恢复后的页面' })).not.toBeInTheDocument()
  })

  it('shows a retry after a failed preview and keeps empty and English states useful', async () => {
    const { history, detail } = fixture()
    history.getVersion = vi.fn().mockRejectedValueOnce(new Error('版本读取失败')).mockResolvedValue(detail)
    const view = render(<PageHistoryPanel history={history} local onEditContent={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /之前标题/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('版本读取失败')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await screen.findByRole('region', { name: '恢复结果预览' })
    view.unmount()
    useI18nStore.setState({ locale: 'en' })
    history.versions = []
    render(<PageHistoryPanel history={history} local onEditContent={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Page history' })).toBeVisible()
    expect(screen.getByText(/This page has no saved versions yet/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Preview previous version' })).toBeDisabled()
    expect(screen.getByText(/up to 50 versions per page/)).toBeVisible()
  })
})
