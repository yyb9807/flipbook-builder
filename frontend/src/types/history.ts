import type { ContentMetadata, FlipNode, Hotspot, SceneDocument } from './index'

export interface PageVersionSummary {
  id: string
  sequence: number
  reason: string
  created_at: string
  summary: { title: string; description: string; section_count: number; hotspot_count: number }
  is_current?: boolean
}
export interface PageVersionList {
  project_revision: number
  current_version_id: string | null
  versions: PageVersionSummary[]
}
export interface PageVersionDetail {
  project_revision: number
  version: PageVersionSummary
  preview: FlipNode
  preserved_branch_count: number
}
export interface PageRestoreResult {
  project_revision: number
  node: FlipNode
  restored_version_id: string
  preserved_branch_count: number
}
/** Local revisions share the current illustration instead of copying its data URL. */
export interface PageSnapshot {
  title: string
  description: string
  scene_document: SceneDocument | null
  content_metadata: ContentMetadata | null
  hotspots: Hotspot[]
}
export interface LocalPageVersion extends PageVersionSummary { snapshot: PageSnapshot }
