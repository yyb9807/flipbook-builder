import type { FlipNode, Hotspot, Project } from '../types'
import { isImageHotspot } from '../types'
import type { LocalPageVersion, PageSnapshot } from '../types/history'
import { newId } from '../data/exampleProject'
import { sectionHotspot } from '../components/scene/sectionHotspot'
import { restoreReferenceMetadata } from './citations'

export const LOCAL_PAGE_VERSION_LIMIT = 50
export function pageSnapshot(node: FlipNode): PageSnapshot {
  return structuredClone({ title: node.title, description: node.description, scene_document: node.scene_document ?? null,
    content_metadata: node.content_metadata ?? null, hotspots: node.hotspots })
}
function meaningfulSnapshot(snapshot: PageSnapshot) {
  return { ...snapshot, hotspots: snapshot.hotspots.map(({ selected: _selected, score: _score, ...hotspot }) => hotspot) }
}
export function pageContentChanged(before: FlipNode, after: FlipNode) {
  return JSON.stringify(meaningfulSnapshot(pageSnapshot(before))) !== JSON.stringify(meaningfulSnapshot(pageSnapshot(after)))
}
export function localVersion(node: FlipNode, sequence: number, reason: string): LocalPageVersion {
  return { id: newId(), sequence, reason, created_at: new Date().toISOString(), is_current: true,
    summary: { title: node.title, description: node.description, section_count: node.scene_document?.sections.length ?? 0, hotspot_count: node.hotspots.length },
    snapshot: pageSnapshot(node) }
}

/** Restore content while retaining every currently valid outgoing connection and subtree. */
export function restorePageSnapshot(project: Project, nodeId: string, snapshot: PageSnapshot): { node: FlipNode; preserved_branch_count: number } {
  const current = project.nodes[nodeId]
  if (!current) throw new Error('页面已不存在')
  const linked = current.hotspots.filter((hotspot) => hotspot.target_node_id && project.nodes[hotspot.target_node_id]?.parent_id === nodeId)
  const historical = new Map(snapshot.hotspots.map((hotspot) => [hotspot.id, hotspot]))
  const preserved_branch_count = linked.filter((hotspot) => historical.get(hotspot.id)?.target_node_id !== hotspot.target_node_id).length
  const activeLinks = new Map(linked.map((hotspot) => [hotspot.id, hotspot.target_node_id]))
  let hotspots: Hotspot[] = snapshot.hotspots.map((hotspot) => ({ ...structuredClone(hotspot), selected: current.hotspots.find((item) => item.id === hotspot.id)?.selected ?? hotspot.selected, target_node_id: activeLinks.get(hotspot.id) ?? null }))
  for (const hotspot of linked) if (!hotspots.some((item) => item.id === hotspot.id)) hotspots.push(structuredClone(hotspot))
  let scene = snapshot.scene_document ? structuredClone(snapshot.scene_document) : null
  const currentSections = current.scene_document?.sections ?? []
  const retainedSectionIds = new Set<string>()
  const retainedIndexes = new Set<number>()
  const linkedSections = currentSections.filter((section, index) => activeLinks.has(sectionHotspot(current, section, index).id))
  if (!scene && linkedSections.length) scene = { version: 1, layout: current.scene_document!.layout, sections: [] }
  if (scene) {
    scene.sections = scene.sections.map((section) => {
      const hotspotId = section.hotspot_id ?? section.id
      return { ...section, hotspot_id: hotspotId, target_node_id: activeLinks.get(hotspotId) ?? null }
    })
    for (const section of linkedSections) {
      const hotspotId = section.hotspot_id ?? section.id
      if (!scene.sections.some((item) => (item.hotspot_id ?? item.id) === hotspotId)) {
        retainedIndexes.add(scene.sections.length)
        scene.sections.push(structuredClone(section))
      }
    }
    if (scene.sections.length > 12) throw new Error('恢复后区块将超过 12 个。已有分支需要保留，请先整理未连接区块。')
    const sectionIds = new Set<string>()
    scene.sections = scene.sections.map((section, index) => {
      const id = sectionIds.has(section.id) ? newId() : section.id
      sectionIds.add(id)
      if (retainedIndexes.has(index)) retainedSectionIds.add(id)
      return { ...section, id }
    })
    const restored = { ...current, scene_document: scene, hotspots }
    hotspots = scene.sections.map((section, index) => ({ ...sectionHotspot(restored, section, index), label: section.title }))
    // An imported mixed page may contain real image connections as well.
    for (const hotspot of linked) if (isImageHotspot(hotspot) && !hotspots.some((item) => item.id === hotspot.id)) hotspots.push(structuredClone(hotspot))
  }
  if (hotspots.length > 12) throw new Error('恢复后连接将超过 12 个。已有分支需要保留，请先整理未连接内容。')
  const metadata = restoreReferenceMetadata(scene, snapshot.content_metadata, current.content_metadata, retainedSectionIds)
  return { node: { ...current, title: snapshot.title, description: snapshot.description, scene_document: scene, content_metadata: metadata, hotspots }, preserved_branch_count }
}
