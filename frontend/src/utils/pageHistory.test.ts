import { describe, expect, it } from 'vitest'
import { createManualProject } from '../data/exampleProject'
import { pageContentChanged, pageSnapshot, restorePageSnapshot } from './pageHistory'
import { connectLocalBranch } from './localBranches'
import type { SceneSection } from '../types'

describe('page restoration preserves graph identity', () => {
  it('retains new connected sections and subtrees, removes obsolete historical targets, and resets review', () => {
    const project = createManualProject('Before', 'en')
    const id = project.root_node_id!
    const node = project.nodes[id]
    node.content_metadata = { version: 1, references: [{ id: 'book', title: 'Reference' }], review_status: 'reviewed' }
    node.image_url = 'data:image/png;base64,current-image'
    const snapshot = pageSnapshot(node)
    snapshot.scene_document!.sections[0].target_node_id = 'deleted-child'
    snapshot.hotspots = [{ id: snapshot.scene_document!.sections[0].id, kind: 'section', label: 'Before', selected: true, target_node_id: 'deleted-child' }]
    const extra: SceneSection = { id: 'new-section', title: 'New linked explanation', body: 'Keep this linked content.' }
    node.scene_document!.sections.push(extra)
    const connected = connectLocalBranch(project, id, extra.id, 'child', 'child-section', 'Child explanation')!
    const restored = restorePageSnapshot(connected.project, id, snapshot)
    expect(restored.preserved_branch_count).toBe(1)
    expect(restored.node.children).toEqual(['child'])
    expect(restored.node.scene_document!.sections.find((section) => section.id === extra.id)?.target_node_id).toBe('child')
    expect(restored.node.hotspots.find((hotspot) => hotspot.id === extra.id)?.target_node_id).toBe('child')
    expect(restored.node.scene_document!.sections[0].target_node_id).toBeNull()
    expect(restored.node.image_url).toBe(node.image_url)
    expect(restored.node.content_metadata?.review_status).toBe('unreviewed')
    expect(connected.project.nodes.child.parent_id).toBe(id)
    expect(snapshot).not.toHaveProperty('image_url')
  })

  it('refuses a restore above the section limit instead of dropping an existing branch', () => {
    const project = createManualProject('Page', 'en')
    const id = project.root_node_id!
    const original = pageSnapshot(project.nodes[id])
    original.scene_document!.sections = Array.from({ length: 12 }, (_, index) => ({ id: `old-${index}`, title: 'Old', body: '' }))
    const connected = connectLocalBranch(project, id, project.nodes[id].scene_document!.sections[0].id, 'child', 'child-section', 'Child explanation')!
    expect(() => restorePageSnapshot(connected.project, id, original)).toThrow('12')
    expect(connected.project.nodes[id].children).toContain('child')
  })

  it('keeps section ids unique when a historic id now belongs to a different connection', () => {
    const project = createManualProject('Page', 'en')
    const id = project.root_node_id!
    const currentSection = project.nodes[id].scene_document!.sections[0]
    const snapshot = pageSnapshot(project.nodes[id])
    snapshot.scene_document!.sections[0].hotspot_id = 'old-hotspot'
    currentSection.hotspot_id = 'new-hotspot'
    const connected = connectLocalBranch(project, id, 'new-hotspot', 'child', 'child-section', 'Child explanation')!
    const restored = restorePageSnapshot(connected.project, id, snapshot)
    expect(new Set(restored.node.scene_document!.sections.map((section) => section.id)).size).toBe(2)
    expect(restored.node.hotspots.find((hotspot) => hotspot.id === 'new-hotspot')?.target_node_id).toBe('child')
  })

  it('does not treat branch selection alone as a content version', () => {
    const project = createManualProject('Page', 'en')
    const node = project.nodes[project.root_node_id!]
    node.hotspots = [{ id: 'h', kind: 'section', label: 'Idea', selected: true, target_node_id: null }]
    expect(pageContentChanged(node, { ...node, hotspots: [{ ...node.hotspots[0], selected: false }] })).toBe(false)
    expect(pageContentChanged(node, { ...node, hotspots: [{ ...node.hotspots[0], label: 'Changed' }] })).toBe(true)
  })
})
