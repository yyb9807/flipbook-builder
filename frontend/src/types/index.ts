export interface HotspotPosition {
  x: number
  y: number
}

export interface HotspotSize {
  width: number
  height: number
}

export interface Hotspot {
  id: string
  label: string
  position: HotspotPosition
  size: HotspotSize
  selected: boolean
  target_node_id: string | null
  score?: number
}

export type NodeStatus = 'draft' | 'generating' | 'generated' | 'completed'
export type SourceType = 'image' | 'text'

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
