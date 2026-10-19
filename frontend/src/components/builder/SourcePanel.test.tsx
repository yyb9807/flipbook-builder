import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { NodeContentEditor } from './NodeContentEditor'
import { api } from '../../api/client'
import { useNodeDraftStore } from '../../store/nodeDraftStore'
import { useI18nStore } from '../../i18n'
import { createManualProject } from '../../data/exampleProject'
import type { ContentReference } from '../../types'
import type { SourceSearchResult } from '../../types/sources'

const reference: ContentReference = { id: 'wiki-copy', title: '受控来源标题', url: 'https://zh.wikipedia.org/w/index.php?title=Water_cycle&oldid=123', excerpt: '这是一段原创受控摘录，用于引用功能测试。', source_revision: '123', retrieved_at: '2026-10-19T06:00:00Z', source_provider: 'wikipedia', source_language: 'zh', license_title: 'CC BY-SA 4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0/', snapshot_sha256: 'a'.repeat(64) }
const result: SourceSearchResult = { provider: 'wikipedia', language: 'zh', query: '水循环', retrieved_at: '2026-10-19T06:00:00Z', candidates: [{ key: 'Water_cycle', page_id: 123, title: reference.title, snippet: '<script>plain text only</script>', url: 'https://zh.wikipedia.org/wiki/Water_cycle' }] }

function page() {
  const project = createManualProject('水循环', 'zh')
  const node = project.nodes[project.root_node_id!]
  node.scene_document!.sections = [{ id: 'first', title: '蒸发', body: '蒸发需要能量。' }, { id: 'second', title: '凝结', body: '冷却可以引起凝结。' }]
  node.content_metadata = { version: 1, references: [], review_status: 'reviewed' }
  return { project, node, draft: () => useNodeDraftStore.getState().drafts[project.project_id]?.[node.id] }
}

beforeEach(() => {
  useI18nStore.setState({ locale: 'zh' })
  useNodeDraftStore.setState({ drafts: {} })
  vi.spyOn(api, 'searchSources').mockResolvedValue(result)
  vi.spyOn(api, 'getSourcePage').mockResolvedValue({ reference, truncated: true })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('source discovery and shared citation drafts', () => {
  it('searches only on request and saves a selected source and section citation in one patch', async () => {
    const { project, node, draft } = page()
    const save = vi.fn().mockResolvedValue(false)
    const { container } = render(<NodeContentEditor node={node} projectId={project.project_id} local mode="sources" selectedHotspotId="second" onSave={save} />)
    expect(api.searchSources).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '水循环' } })
    expect(api.searchSources).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '检索' }))
    await screen.findByText(reference.title)
    expect(container.querySelector('script')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '查看摘录' }))
    await screen.findByRole('region', { name: '来源摘录预览' })
    expect(draft()).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: '加入并关联此区块' }))
    expect(screen.getByRole('group', { name: '参考资料 1' })).toHaveFocus()
    expect(screen.queryByRole('region', { name: '来源摘录预览' })).not.toBeInTheDocument()
    expect(screen.queryByText('找到 1 条候选资料')).not.toBeInTheDocument()
    expect(draft()?.scene_document?.sections[1].reference_ids).toEqual(['wiki-copy'])
    expect(draft()?.scene_document?.sections[0].reference_ids).toBeUndefined()
    expect(draft()?.content_metadata?.references[0]).toEqual(reference)
    expect(draft()?.content_metadata?.review_status).toBe('unreviewed')
    fireEvent.click(screen.getByRole('button', { name: '保存页面与引用' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0][0].content_metadata.references[0]).toEqual(reference)
    expect(save.mock.calls[0][0].scene_document.sections[1].reference_ids).toEqual(['wiki-copy'])
  })

  it('returns keyboard focus to the candidate after closing its preview', async () => {
    const user = userEvent.setup()
    const { project, node } = page()
    render(<NodeContentEditor node={node} projectId={project.project_id} local mode="sources" onSave={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '检索' }))
    await user.click(await screen.findByRole('button', { name: '查看摘录' }))
    expect(await screen.findByRole('region', { name: '来源摘录预览' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: '返回检索结果' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: '查看摘录' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('region', { name: '来源摘录预览' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: '仅加入本页资料' }))
    expect(screen.getByRole('group', { name: '参考资料 1' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: '移除参考资料 1' })).toHaveFocus()
  })

  it('retains a content draft when changing tools and preserves source metadata on an ordinary title save', async () => {
    const { project, node, draft } = page()
    node.content_metadata!.references = [reference]
    node.scene_document!.sections[0].reference_ids = [reference.id]
    const save = vi.fn().mockResolvedValue(false)
    const view = render(<NodeContentEditor node={node} projectId={project.project_id} local mode="content" onSave={save} />)
    fireEvent.change(screen.getByRole('textbox', { name: '标题' }), { target: { value: '新的页面标题' } })
    view.rerender(<NodeContentEditor node={node} projectId={project.project_id} local mode="sources" onSave={save} />)
    expect(draft()?.title).toBe('新的页面标题')
    expect(save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '保存页面与引用' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0][0]).toMatchObject({ title: '新的页面标题', content_metadata: { references: [reference] } })
  })

  it('requires unlinking before source removal and does not delete any section text', () => {
    const { project, node, draft } = page()
    node.content_metadata!.references = [reference]
    node.scene_document!.sections[0].reference_ids = [reference.id]
    render(<NodeContentEditor node={node} projectId={project.project_id} local mode="sources" onSave={vi.fn()} />)
    expect(screen.getByRole('button', { name: '移除参考资料 1' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: '引用到「蒸发」' }))
    fireEvent.click(screen.getByRole('button', { name: '移除参考资料 1' }))
    expect(draft()?.content_metadata?.references).toEqual([])
    expect(draft()?.scene_document?.sections[0]).toMatchObject({ body: '蒸发需要能量。', reference_ids: [] })
  })

  it('aborts a previous page lookup and cannot inject a late candidate into the next page', async () => {
    const first = page(); const second = page()
    let finish!: (value: SourceSearchResult) => void
    vi.mocked(api.searchSources).mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    const view = render(<NodeContentEditor node={first.node} projectId={first.project.project_id} local mode="sources" onSave={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '检索' }))
    const signal = vi.mocked(api.searchSources).mock.calls[0][2]!
    view.rerender(<NodeContentEditor node={second.node} projectId={second.project.project_id} local mode="sources" onSave={vi.fn()} />)
    expect(signal.aborted).toBe(true)
    await act(async () => { finish(result) })
    expect(screen.queryByText(reference.title)).not.toBeInTheDocument()
    expect(second.draft()).toBeUndefined()
  })

  it('keeps the query and existing page data after an upstream failure and permits manual entry', async () => {
    const { project, node, draft } = page()
    node.content_metadata!.references = [reference]
    vi.mocked(api.searchSources).mockRejectedValueOnce(Object.assign(new Error('upstream busy'), { code: 'source_rate_limited' }))
    render(<NodeContentEditor node={node} projectId={project.project_id} local mode="sources" onSave={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '检索' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('来源服务暂时繁忙')
    expect(screen.getByRole('searchbox')).toHaveValue('蒸发')
    expect(draft()).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: '添加参考资料' }))
    const newReference = screen.getByRole('group', { name: '参考资料 2' })
    const title = within(newReference).getByRole('textbox', { name: '资料标题' })
    fireEvent.change(title, { target: { value: '手工书目' } })
    expect(title).toBeVisible()
    expect(within(newReference).getByRole('textbox', { name: '保存的来源摘录（可选）' })).toBeVisible()
    expect(draft()?.content_metadata?.references[0]).toEqual(reference)
  })

  it('uses explicit source language and announces empty results without changing the page', async () => {
    const { project, node, draft } = page()
    vi.mocked(api.searchSources).mockResolvedValueOnce({ ...result, candidates: [] })
    render(<NodeContentEditor node={node} projectId={project.project_id} local mode="sources" onSave={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox', { name: '来源语言' }), { target: { value: 'en' } })
    fireEvent.click(screen.getByRole('button', { name: '检索' }))
    await screen.findByText(/没有找到匹配资料/)
    expect(api.searchSources).toHaveBeenCalledWith('蒸发', 'en', expect.any(AbortSignal))
    expect(draft()).toBeUndefined()
  })
})
