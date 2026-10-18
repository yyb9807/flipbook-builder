import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HotspotPanel } from './HotspotPanel'
import { createExampleProject } from '../../data/exampleProject'

afterEach(cleanup)
describe('branch actions match the project mode', () => {
  it('opens a linked page directly without changing selection', () => {
    const project = createExampleProject()
    const node = project.nodes[project.root_node_id!]
    const open = vi.fn(), select = vi.fn(), change = vi.fn()
    render(<HotspotPanel node={node} local onHotspotChange={change} onSelect={select} onOpen={open} />)
    fireEvent.click(screen.getByRole('button', { name: '打开分支：凝结' }))
    expect(open).toHaveBeenCalledWith(node.hotspots[1])
    expect(select).not.toHaveBeenCalled()
    expect(change).not.toHaveBeenCalled()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('only offers server generation selection for an unconnected hotspot', () => {
    const project = createExampleProject()
    const root = project.nodes[project.root_node_id!]
    const node = { ...root, scene_document: null, hotspots: [root.hotspots[0], { ...root.hotspots[1], target_node_id: null, selected: false }] }
    const change = vi.fn()
    render(<HotspotPanel node={node} onHotspotChange={change} />)
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 凝结' }))
    expect(change).toHaveBeenCalledWith({ ...node.hotspots[1], selected: true })
    expect(screen.getByRole('button', { name: '打开分支：蒸发' })).toBeInTheDocument()
  })
})
