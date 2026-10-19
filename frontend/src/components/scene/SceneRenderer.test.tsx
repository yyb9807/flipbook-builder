import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FlipNode, Hotspot, Project } from '../../types'
import { SceneRenderer } from './SceneRenderer'
import { SceneEditor } from './SceneEditor'
import { ProjectViewer } from './ProjectViewer'
import { hotspotCenter, moveHotspot } from './geometry'

const hotspot: Hotspot = { id: 'hotspot', label: '湖泊', position: { x: .2, y: .3 }, size: { width: .2, height: .2 }, selected: false, target_node_id: 'child' }
const node: FlipNode = { id: 'root', parent_id: null, depth: 0, title: '水循环', description: '从这里开始探索。', source_type: 'image', image_url: '/image.png', children: ['child'], hotspots: [hotspot], status: 'completed' }

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('shared scene geometry', () => {
  it('keeps the entire image and its hotspots in one natural-ratio box', () => {
    const { container } = render(<SceneRenderer node={node} onHotspotActivate={vi.fn()} />)
    const image = screen.getByRole('img')
    Object.defineProperties(image, { naturalWidth: { value: 1600 }, naturalHeight: { value: 800 } })
    fireEvent.load(image)
    const box = container.querySelector('.scene-image-box') as HTMLElement
    expect(Number.parseFloat(box.style.aspectRatio)).toBe(2)
    const marker = screen.getByRole('button', { name: '湖泊' })
    expect(marker.parentElement).toBe(box)
    expect(Number.parseFloat(marker.style.left)).toBeCloseTo(30)
    expect(Number.parseFloat(marker.style.top)).toBeCloseTo(40)
  })

  it('clamps the whole region rather than its center to the image boundary', () => {
    const result = moveHotspot(hotspot, 2, -3)
    expect(result.position).toEqual({ x: .8, y: 0 })
    expect(hotspotCenter(result)).toEqual({ x: .9, y: .1 })
  })

  it('keeps drag previews local and commits once on release', () => {
    vi.stubGlobal('PointerEvent', MouseEvent)
    const commit = vi.fn()
    const select = vi.fn()
    render(<SceneEditor node={node} onHotspotCommit={commit} onHotspotSelect={select} />)
    const marker = screen.getByRole('button', { name: /选择热点：湖泊/ })
    vi.spyOn(marker.parentElement!, 'getBoundingClientRect').mockReturnValue({ width: 200, height: 100 } as DOMRect)
    fireEvent.pointerDown(marker, { button: 0, clientX: 60, clientY: 40 })
    fireEvent.pointerMove(marker, { clientX: 80, clientY: 50 })
    fireEvent.pointerMove(marker, { clientX: 100, clientY: 60 })
    expect(commit).not.toHaveBeenCalled()
    fireEvent.pointerUp(marker)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit.mock.calls[0][0].position).toEqual({ x: .4, y: .5 })
    expect(select).toHaveBeenCalledWith(hotspot)
  })

  it('supports keyboard movement and lets Escape cancel it', () => {
    const commit = vi.fn()
    render(<SceneEditor node={node} onHotspotCommit={commit} />)
    const marker = screen.getByRole('button', { name: /选择热点：湖泊/ })
    fireEvent.keyDown(marker, { key: 'ArrowRight' })
    fireEvent.keyDown(marker, { key: 'ArrowRight' })
    expect(commit).not.toHaveBeenCalled()
    fireEvent.keyUp(marker, { key: 'ArrowRight' })
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit.mock.calls[0][0].position.x).toBeCloseTo(.21)
    fireEvent.keyDown(marker, { key: 'ArrowDown' })
    fireEvent.keyDown(marker, { key: 'Escape' })
    fireEvent.keyUp(marker, { key: 'ArrowDown' })
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('renders structured content as text and selects sections without moving them', () => {
    const select = vi.fn()
    const { container } = render(<SceneEditor node={{ ...node, scene_document: { version: 1, layout: 'atlas', sections: [{ id: 'part', hotspot_id: 'hotspot', title: '湖泊与蓄水', body: '水在湖泊中暂时储存。' }] } }} onHotspotCommit={vi.fn()} onHotspotSelect={select} />)
    fireEvent.click(screen.getByRole('button', { name: '湖泊与蓄水' }))
    expect(select).toHaveBeenCalledWith(hotspot)
    expect(screen.getByText('水在湖泊中暂时储存。')).toBeInTheDocument()
    expect(container.querySelector('.scene-editor-overlay')).toBeNull()
  })

  it('never positions section connections over an image or exposes image movement controls for them', () => {
    const sectionNode: FlipNode = { ...node, hotspots: [{ id: 'section', kind: 'section', label: '知识区块', selected: true, target_node_id: 'child', position: null, size: null, score: null }] }
    const view = render(<SceneRenderer node={sectionNode} onHotspotActivate={vi.fn()} />)
    expect(view.container.querySelector('.scene-hotspot')).toBeNull()
    view.rerender(<SceneEditor node={sectionNode} onHotspotCommit={vi.fn()} onHotspotSelect={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /使用方向键移动/ })).not.toBeInTheDocument()
    view.rerender(<SceneEditor node={{ ...sectionNode, scene_document: { version: 1, layout: 'sequence', sections: [{ id: 'section-text', hotspot_id: 'section', title: '知识区块', body: '可阅读的正文。' }] } }} onHotspotCommit={vi.fn()} onHotspotSelect={vi.fn()} onHotspotOpen={vi.fn()} />)
    expect(screen.getByRole('button', { name: '知识区块' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '打开页面' })).toBeInTheDocument()
    expect(view.container.querySelector('.scene-editor-overlay')).toBeNull()
  })

  it('runs read-only branch navigation without a workspace store or editing exit', () => {
    const project: Project = { project_id: 'work', name: '自然笔记', root_node_id: 'root', settings: { max_depth: 4, max_hotspots_per_page: 3, visual_style: 'atlas', language: 'zh' }, nodes: { root: node, child: { ...node, id: 'child', parent_id: 'root', title: '湖泊细节', children: [], hotspots: [] } } }
    render(<ProjectViewer project={project} />)
    fireEvent.click(screen.getAllByRole('button', { name: '湖泊' })[0])
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('湖泊细节')
    expect(screen.queryByRole('button', { name: '返回编辑' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '上一层' }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('水循环')
  })
})


describe('shared citation navigation', () => {
  it('uses current reference numbering and unique anchors across simultaneous saved/history views, with keyboard focus both ways', async () => {
    const user = userEvent.setup()
    const cited: FlipNode = { ...node, image_url: null, hotspots: [], scene_document: { version: 1, layout: 'atlas', sections: [{ id: '区块/%:water', title: '蒸发', body: '可阅读的解释。', reference_ids: ['来源/%:water'] }] }, content_metadata: { version: 1, review_status: 'unreviewed', references: [{ id: 'unlinked', title: 'A page-only reference' }, { id: '来源/%:water', title: 'Water source', excerpt: 'A saved source copy.' }] } }
    const before = JSON.stringify(cited)
    const view = render(<><SceneRenderer node={cited} /><SceneRenderer node={cited} /></>)
    const ids = [...view.container.querySelectorAll('[id]')].map((element) => element.id)
    expect(new Set(ids).size).toBe(ids.length)
    const renderers = view.container.querySelectorAll<HTMLElement>('.scene-renderer')
    const citation = within(renderers[1]).getByRole('link', { name: '查看参考资料 2: Water source' })
    expect(citation).toHaveTextContent('[2]')
    citation.focus()
    await user.keyboard('{Enter}')
    const reference = document.getElementById(citation.getAttribute('href')!.slice(1))!
    expect(reference).toHaveFocus()
    expect(renderers[1].contains(reference)).toBe(true)
    expect(renderers[0].contains(reference)).toBe(false)
    const back = within(reference).getByRole('link', { name: '返回「蒸发」' })
    back.focus()
    await user.keyboard('{Enter}')
    const section = document.getElementById(back.getAttribute('href')!.slice(1))!
    expect(section).toHaveFocus()
    expect(section).toHaveTextContent('可阅读的解释。')
    expect(renderers[1].contains(section)).toBe(true)
    expect(JSON.stringify(cited)).toBe(before)
  })
})
