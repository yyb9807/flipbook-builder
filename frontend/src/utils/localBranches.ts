import { sectionHotspot } from '../components/scene/sectionHotspot'
import type { FlipNode, Project } from '../types'

/** Materialize a local section and its branch in one project update, without a save detour. */
export function connectLocalBranch(project: Project, parentId: string, hotspotId: string, childId: string, sectionId: string, sectionTitle: string): { project: Project; nodeId: string } | null {
  const parent = project.nodes[parentId]
  if (!parent) return null
  const hotspots = parent.scene_document
    ? parent.scene_document.sections.map((section, index) => sectionHotspot(parent, section, index))
    : parent.hotspots
  const hotspot = hotspots.find((item) => item.id === hotspotId)
  if (!hotspot) return null
  if (hotspot.target_node_id) return project.nodes[hotspot.target_node_id] ? { project, nodeId: hotspot.target_node_id } : null
  if (project.nodes[childId]) return null
  const child: FlipNode = {
    id: childId, parent_id: parentId, depth: parent.depth + 1, title: hotspot.label,
    description: '', source_type: 'text', image_url: null, children: [], hotspots: [], status: 'draft',
    scene_document: { version: 1, layout: 'sequence', sections: [{ id: sectionId, title: sectionTitle, body: '' }] },
  }
  const nextParent: FlipNode = {
    ...parent,
    children: [...new Set([...parent.children, childId])],
    hotspots: hotspots.map((item) => item.id === hotspotId ? { ...item, target_node_id: childId } : item),
    ...(parent.scene_document ? { scene_document: { ...parent.scene_document, sections: parent.scene_document.sections.map((section, index) => {
      const identity = sectionHotspot(parent, section, index).id
      return { ...section, hotspot_id: identity, ...(identity === hotspotId ? { target_node_id: childId } : {}) }
    }) } } : {}),
  }
  return { project: { ...project, nodes: { ...project.nodes, [parentId]: nextParent, [childId]: child } }, nodeId: childId }
}
