import { describe, expect, it } from 'vitest'
import { createExampleProject } from '../data/exampleProject'
import { sectionHotspot } from '../components/scene/sectionHotspot'
import { connectLocalBranch } from './localBranches'

describe('local section branches', () => {
  it('connects an untouched section with one stable identity in editor and reader data', () => {
    const project = createExampleProject()
    const parentId = project.nodes[project.root_node_id!].children[0]
    const parent = project.nodes[parentId]
    const section = parent.scene_document!.sections[1]
    expect(parent.hotspots).toHaveLength(0)
    const result = connectLocalBranch(project, parentId, section.id, 'new-page', 'new-section', 'Explain further')!
    const saved = result.project.nodes[parentId]
    expect(saved.children).toEqual(['new-page'])
    expect(saved.scene_document!.sections[1]).toMatchObject({ id: section.id, hotspot_id: section.id, target_node_id: 'new-page' })
    expect(sectionHotspot(saved, saved.scene_document!.sections[1], 1)).toMatchObject({ id: section.id, target_node_id: 'new-page' })
    expect(result.project.nodes['new-page']).toMatchObject({ parent_id: parentId, depth: 2, title: section.title })
    expect(parent.hotspots).toHaveLength(0)
    expect(parent.children).toHaveLength(0)
  })

  it('does not create another child when an old click is delivered twice', () => {
    const project = createExampleProject()
    const parentId = project.nodes[project.root_node_id!].children[0]
    const section = project.nodes[parentId].scene_document!.sections[0]
    const first = connectLocalBranch(project, parentId, section.id, 'first', 'detail', 'Explain')!
    const second = connectLocalBranch(first.project, parentId, section.id, 'second', 'other', 'Explain')!
    expect(second.project).toBe(first.project)
    expect(second.nodeId).toBe('first')
    expect(second.project.nodes.second).toBeUndefined()
  })

  it('preserves existing branch identities and metadata when connecting another section', () => {
    const project = createExampleProject()
    const parentId = project.nodes[project.root_node_id!].children[0]
    const section = project.nodes[parentId].scene_document!.sections[0]
    const first = connectLocalBranch(project, parentId, section.id, 'first', 'detail', 'Explain')!
    const parent = first.project.nodes[parentId]
    parent.hotspots[0] = { ...parent.hotspots[0], selected: true }
    expect(parent.hotspots[0]).toMatchObject({ kind: 'section' })
    expect(parent.hotspots[0].position).toBeUndefined()
    expect(parent.hotspots[0].size).toBeUndefined()
    const second = connectLocalBranch(first.project, parentId, parent.scene_document!.sections[1].id, 'second', 'detail2', 'Explain')!
    expect(second.project.nodes[parentId].hotspots[0]).toEqual(parent.hotspots[0])
    expect(second.project.nodes[parentId].children).toEqual(['first', 'second'])
    expect(second.project.nodes.first).toBe(first.project.nodes.first)
  })

  it('ignores a section identity that is not part of this page', () => {
    const project = createExampleProject()
    expect(connectLocalBranch(project, project.root_node_id!, 'foreign-section', 'new', 'detail', 'Explain')).toBeNull()
  })
})
