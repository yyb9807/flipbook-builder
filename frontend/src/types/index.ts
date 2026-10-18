export interface HotspotPosition {
  x: number
  y: number
}

export interface HotspotSize {
  width: number
  height: number
}

interface HotspotBase {
  id: string
  label: string
  selected: boolean
  target_node_id: string | null
}

export interface ImageHotspot extends HotspotBase {
  kind?: 'image'
  position: HotspotPosition
  size: HotspotSize
  score?: number | null
}

/** A content connection has no position in an illustration. */
export interface SectionConnection extends HotspotBase {
  kind: 'section'
  position?: null
  size?: null
  score?: null
}

export type Hotspot = ImageHotspot | SectionConnection

export function isImageHotspot(hotspot: Hotspot): hotspot is ImageHotspot {
  return hotspot.kind !== 'section' && !!hotspot.position && !!hotspot.size
}

export type NodeStatus = 'draft' | 'generating' | 'generated' | 'completed'
export type SourceType = 'image' | 'text'

export interface SceneSection {
  id: string
  title: string
  body: string
  hotspot_id?: string
  target_node_id?: string | null
}

export interface SceneDocument {
  version: 1
  layout: 'atlas' | 'sequence'
  sections: SceneSection[]
}

export interface ContentReference {
  id: string
  title: string
  url?: string
  note?: string
}

export interface ContentMetadata {
  version: 1
  provenance?: {
    kind: 'ai'
    input_kind: 'text' | 'image' | 'parent_page' | 'page'
    model: string
  }
  references: ContentReference[]
  review_status: 'unreviewed' | 'reviewed'
}

export interface FlipNode {
  id: string
  parent_id: string | null
  depth: number
  title: string
  description: string
  source_type: SourceType
  image_url: string | null
  children: string[]
  hotspots: Hotspot[]
  status: NodeStatus
  scene_document?: SceneDocument | null
  content_metadata?: ContentMetadata | null
}

export interface ProjectSettings {
  max_depth: number
  max_hotspots_per_page: number
  visual_style: string
  language: string
}

export interface Project {
  project_id: string
  name: string
  root_node_id: string | null
  settings: ProjectSettings
  nodes: Record<string, FlipNode>
}

export interface Keyword {
  label: string
  description: string
}

export interface AnalyzeResult {
  node_id: string
  summary: string
  main_objects: string[]
  scene_type: string
  image_url: string | null
  source_type: SourceType
  hotspots: Hotspot[]
  keywords: Keyword[]
}
