import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NodeContentEditor } from './NodeContentEditor'
import { ModeToggle } from '../shared/ModeToggle'
import { useNodeDraftStore } from '../../store/nodeDraftStore'
import { useProjectStore } from '../../store/projectStore'
import { createManualProject } from '../../data/exampleProject'
import type { FlipNode } from '../../types'
import { ConfirmHost } from '../shared/ConfirmDialog'

beforeEach(() => { useNodeDraftStore.setState({ drafts: {} }); useProjectStore.getState().resetProject() })
afterEach(cleanup)

function twoSectionProject() {
  const project = createManualProject('original', 'zh')
  const node = project.nodes[project.root_node_id!]
  node.scene_document = { version: 1, layout: 'atlas', sections: [
    { id: 'first-section', hotspot_id: 'first-hotspot', title: '第一个小标题', body: '第一段解释' },
    { id: 'second-section', title: '第二个小标题', body: '第二段解释' },
  ] }
  return { project, node }
}

describe('selected section editing', () => {
  it('locates and focuses the second section selected on the canvas', () => {
    const { project, node } = twoSectionProject()
    const save = vi.fn().mockResolvedValue(true)
    const view = render(<NodeContentEditor projectId={project.project_id} node={node} local onSave={save} />)
    const second = screen.getByRole('group', { name: '内容区块 2：第二个小标题' })
    const scrollIntoView = vi.fn()
    Object.defineProperty(second, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    view.rerender(<NodeContentEditor projectId={project.project_id} node={node} local selectedHotspotId="second-section" onSave={save} />)
    expect(within(second).getByRole('textbox', { name: '小标题' })).toHaveFocus()
    expect(second).toHaveClass('is-selected')
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    expect(screen.getByText('正在编辑区块 2：第二个小标题')).toBeVisible()
    view.rerender(<NodeContentEditor projectId={project.project_id} node={node} local selectedHotspotId="first-hotspot" onSave={save} />)
    expect(within(screen.getByRole('group', { name: '内容区块 1：第一个小标题' })).getByRole('textbox', { name: '小标题' })).toHaveFocus()
  })

  it('keeps focus in the explanation during typing and unrelated rerenders', () => {
    const { project, node } = twoSectionProject()
    const save = vi.fn().mockResolvedValue(true)
    const view = render(<NodeContentEditor projectId={project.project_id} node={node} local selectedHotspotId="second-section" onSave={save} />)
    const second = screen.getByRole('group', { name: '内容区块 2：第二个小标题' })
    const explanation = within(second).getByRole('textbox', { name: '解释' })
    explanation.focus()
    fireEvent.change(explanation, { target: { value: '继续写第二段解释' } })
    expect(explanation).toHaveFocus()
    view.rerender(<NodeContentEditor projectId={project.project_id} node={{ ...node }} local selectedHotspotId="second-section" onSave={save} />)
    expect(explanation).toHaveFocus()
    expect(explanation).toHaveValue('继续写第二段解释')
  })

  it('saves the shared stable identities and keeps existing links and hotspot metadata', async () => {
    const { project, node } = twoSectionProject()
    node.hotspots = [
      { id: 'first-hotspot', label: '旧标题一', selected: false, target_node_id: 'first-child', position: { x: .1, y: .2 }, size: { width: .2, height: .3 } },
      { id: 'second-section', label: '旧标题二', selected: true, target_node_id: 'second-child', position: { x: .3, y: .4 }, size: { width: .1, height: .2 }, score: .92 },
    ]
    const save = vi.fn<(patch: Partial<FlipNode>) => Promise<boolean>>().mockResolvedValue(true)
    render(<NodeContentEditor projectId={project.project_id} node={node} local selectedHotspotId="second-section" onSave={save} />)
    fireEvent.change(within(screen.getByRole('group', { name: '内容区块 2：第二个小标题' })).getByRole('textbox', { name: '小标题' }), { target: { value: '第二个新标题' } })
    fireEvent.click(screen.getByRole('button', { name: '保存页面内容' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    const patch = save.mock.calls[0][0]
    expect(patch.hotspots).toEqual([
      { ...node.hotspots[0], label: '第一个小标题' },
      { ...node.hotspots[1], label: '第二个新标题' },
    ])
    expect(patch.scene_document?.sections.map((section) => section.hotspot_id)).toEqual(['first-hotspot', 'second-section'])
  })

  it('uses the section identity for a new local branch and leaves server hotspot identities untouched', async () => {
    const { project, node } = twoSectionProject()
    node.scene_document!.sections[1].target_node_id = 'existing-section-child'
    const save = vi.fn<(patch: Partial<FlipNode>) => Promise<boolean>>().mockResolvedValue(false)
    const view = render(<NodeContentEditor projectId={project.project_id} node={node} local onSave={save} />)
    fireEvent.change(screen.getByRole('textbox', { name: '标题' }), { target: { value: 'edited' } })
    fireEvent.click(screen.getByRole('button', { name: '保存页面内容' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0][0].hotspots?.[1]).toMatchObject({ id: 'second-section', target_node_id: 'existing-section-child' })
    await waitFor(() => expect(screen.getByRole('button', { name: '保存页面内容' })).toBeEnabled())
    view.rerender(<NodeContentEditor projectId={project.project_id} node={node} local={false} onSave={save} />)
    fireEvent.click(screen.getByRole('button', { name: '保存页面内容' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save.mock.calls[1][0]).not.toHaveProperty('hotspots')
    expect(save.mock.calls[1][0].scene_document?.sections[1]).not.toHaveProperty('hotspot_id')
  })
})

describe('persistent content drafts', () => {
  it('discards only the current page draft after confirmation and keeps linked sections protected', async () => {
    const { project, node } = twoSectionProject()
    node.scene_document!.sections[0].target_node_id = 'existing-child'
    const otherDraft = { title: '另一页草稿', description: '', scene_document: null }
    useNodeDraftStore.getState().setDraft(project.project_id, 'other-page', otherDraft)
    render(<><NodeContentEditor projectId={project.project_id} node={node} local onSave={vi.fn()} /><ConfirmHost /></>)
    expect(screen.getByRole('button', { name: '移除区块 1' })).toBeDisabled()
    expect(screen.getByText('此区块已连接子页，保留区块可保护分支关系。')).toBeVisible()
    fireEvent.change(screen.getByRole('textbox', { name: '标题' }), { target: { value: '未保存的新标题' } })
    const discard = screen.getByRole('button', { name: '撤回本次修改' })
    discard.focus()
    fireEvent.click(discard)
    let dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: '取消' })).toHaveFocus()
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(discard).toHaveFocus()
    expect(screen.getByRole('textbox', { name: '标题' })).toHaveValue('未保存的新标题')
    fireEvent.click(discard)
    dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '撤回本次修改' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '标题' })).toHaveValue(node.title))
    expect(useNodeDraftStore.getState().drafts[project.project_id][node.id]).toBeUndefined()
    expect(useNodeDraftStore.getState().drafts[project.project_id]['other-page']).toBe(otherDraft)
    expect(node.scene_document!.sections[0].target_node_id).toBe('existing-child')
  })

  it('keeps typed text when the inspector is unmounted and blocks an outdated preview', () => {
    const project = createManualProject('original', 'zh')
    const node = project.nodes[project.root_node_id!]
    useProjectStore.getState().openProject(project, 'local')
    const save = vi.fn().mockResolvedValue(true)
    const { unmount } = render(<NodeContentEditor projectId={project.project_id} node={node} local onSave={save} />)
    fireEvent.change(screen.getByRole('textbox', { name: '标题' }), { target: { value: 'my unsaved title' } })
    unmount()
    render(<><NodeContentEditor projectId={project.project_id} node={node} local onSave={save} /><ModeToggle /></>)
    expect(screen.getByRole('textbox', { name: '标题' })).toHaveValue('my unsaved title')
    expect(screen.getByRole('button', { name: '预览作品' })).toBeDisabled()
    expect(localStorage.getItem('flipbook-node-drafts')).toContain('my unsaved title')
  })

  it('clears a draft only after a successful save', async () => {
    const project = createManualProject('original', 'zh')
    const node = project.nodes[project.root_node_id!]
    const save = vi.fn().mockResolvedValue(false)
    render(<NodeContentEditor projectId={project.project_id} node={node} local onSave={save} />)
    fireEvent.change(screen.getByRole('textbox', { name: '标题' }), { target: { value: 'kept' } })
    fireEvent.click(screen.getByRole('button', { name: '保存页面内容' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(useNodeDraftStore.getState().drafts[project.project_id][node.id].title).toBe('kept')
    save.mockResolvedValue(true)
    await waitFor(() => expect(screen.getByRole('button', { name: '保存页面内容' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '保存页面内容' }))
    await waitFor(() => expect(useNodeDraftStore.getState().drafts[project.project_id][node.id]).toBeUndefined())
  })

  it('does not discard newer typing when an older, unmounted form finishes saving', async () => {
    const project = createManualProject('original', 'zh')
    const node = project.nodes[project.root_node_id!]
    let finish!: (ok: boolean) => void
    const save = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve }))
    const first = render(<NodeContentEditor projectId={project.project_id} node={node} local onSave={save} />)
    fireEvent.change(screen.getByRole('textbox', { name: '标题' }), { target: { value: 'first' } })
    fireEvent.click(screen.getByRole('button', { name: '保存页面内容' }))
    first.unmount()
    render(<NodeContentEditor projectId={project.project_id} node={node} local onSave={save} />)
    fireEvent.change(screen.getByRole('textbox', { name: '标题' }), { target: { value: 'second' } })
    await act(async () => { finish(true) })
    expect(useNodeDraftStore.getState().drafts[project.project_id][node.id].title).toBe('second')
    expect(screen.getByRole('textbox', { name: '标题' })).toHaveValue('second')
  })
})

describe('reference editing and author review', () => {
  it('keeps invalid references in a draft and prevents saving unsafe URLs', async () => {
    const { project, node } = twoSectionProject()
    node.content_metadata = { version: 1, references: [], review_status: 'reviewed', provenance: { kind: 'ai', input_kind: 'text', model: 'content-model' } }
    const save = vi.fn().mockResolvedValue(true)
    const first = render(<NodeContentEditor projectId={project.project_id} node={node} local onSave={save} />)
    fireEvent.click(screen.getByRole('button', { name: '添加参考资料' }))
    fireEvent.change(screen.getByRole('textbox', { name: '资料标题' }), { target: { value: '水循环参考' } })
    fireEvent.change(screen.getByRole('textbox', { name: '网页地址（可选）' }), { target: { value: 'javascript:alert(1)' } })
    expect(screen.getByRole('alert')).toHaveTextContent('资料仍保留在草稿中')
    expect(screen.getByRole('button', { name: '保存页面内容' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: '我已人工核对页面内容和参考资料' })).not.toBeChecked()
    first.unmount()
    render(<NodeContentEditor projectId={project.project_id} node={node} local onSave={save} />)
    expect(screen.getByRole('textbox', { name: '网页地址（可选）' })).toHaveValue('javascript:alert(1)')
    expect(save).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('textbox', { name: '网页地址（可选）' }), { target: { value: 'https://example.org/water' } })
    fireEvent.change(screen.getByRole('textbox', { name: '资料说明（可选）' }), { target: { value: '第二章' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '我已人工核对页面内容和参考资料' }))
    fireEvent.click(screen.getByRole('button', { name: '保存页面内容' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0][0].content_metadata).toMatchObject({
      provenance: node.content_metadata.provenance, review_status: 'reviewed',
      references: [{ title: '水循环参考', url: 'https://example.org/water', note: '第二章' }],
    })
    expect(useNodeDraftStore.getState().drafts[project.project_id]?.[node.id]).toBeUndefined()
  })

  it('invalidates author review when page content changes and supports references on an old image page', () => {
    const { project, node } = twoSectionProject()
    node.scene_document = null
    node.content_metadata = { version: 1, references: [{ id: 'book', title: 'Water book' }], review_status: 'reviewed' }
    render(<NodeContentEditor projectId={project.project_id} node={node} local={false} onSave={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox', { name: '页面说明' }), { target: { value: '新的解释' } })
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(useNodeDraftStore.getState().drafts[project.project_id][node.id].scene_document).toBeNull()
    expect(useNodeDraftStore.getState().drafts[project.project_id][node.id].content_metadata).toEqual({ version: 1, references: [{ id: 'book', title: 'Water book' }], review_status: 'unreviewed' })
    expect(screen.getByText('未记录生成方式。')).toBeInTheDocument()
  })

  it('adds references to an older image page without inventing a structured document or AI provenance', async () => {
    const { project, node } = twoSectionProject()
    node.scene_document = null
    const save = vi.fn().mockResolvedValue(true)
    render(<NodeContentEditor projectId={project.project_id} node={node} local={false} onSave={save} />)
    fireEvent.click(screen.getByRole('button', { name: '添加参考资料' }))
    fireEvent.change(screen.getByRole('textbox', { name: '资料标题' }), { target: { value: '纸本参考书' } })
    fireEvent.click(screen.getByRole('button', { name: '保存页面内容' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0][0].scene_document).toBeNull()
    expect(save.mock.calls[0][0].content_metadata).toMatchObject({ version: 1, references: [{ title: '纸本参考书' }], review_status: 'unreviewed' })
    expect(save.mock.calls[0][0].content_metadata).not.toHaveProperty('provenance')
  })
})
