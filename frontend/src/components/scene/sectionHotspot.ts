import type { FlipNode, Hotspot, SceneSection } from '../../types'

/** Stable section identity is shared by editing, branching and all readers. */
export function sectionHotspot(node: FlipNode, section: SceneSection, _index?: number): Hotspot {
  const id = section.hotspot_id ?? section.id
  const existing = node.hotspots.find((hotspot) => hotspot.id === id)
  if (existing) return existing
  return {
    id,
    kind: 'section',
    label: section.title,
    selected: false,
    target_node_id: section.target_node_id ?? null,
  }
}
