/**
 * 后端 API 响应类型定义。
 * 集中放在这里避免在 hooks / pages / components 里就地重复定义。
 */
import type { Hotspot, Keyword, SourceType } from './index'

// ── /api/projects ──
export interface CreateProjectResponse {
  project_id: string
  name: string
  settings: object
}

// ── /api/projects/{id}/analyze (SSE) ──
export interface AnalyzeStreamDone {
  done: true
  node_id: string
  summary: string
  main_objects: string[]
  scene_type: string
  image_url: string | null
  source_type: SourceType
  hotspots: Hotspot[]
  keywords: Keyword[]
}

// ── /api/projects/{id}/nodes/{nid}/generate-children (SSE) ──
export interface GenChildNode {
  id: string
  parent_id: string
  depth: number
  title: string
  description: string
  image_url: string | null
  hotspot_id: string
  hotspots: Hotspot[]
}

export interface GenChildrenStreamDone {
  done: true
  nodes: GenChildNode[]
}

// ── /api/projects/{id}/nodes/{nid}/regenerate ──
export interface RegenerateResponse {
  id: string
  title: string
  description: string
  image_url: string | null
  status: string
}

// ── /api/projects 列表 ──
export interface ProjectListItem {
  project_id: string
  name: string
  thumbnail: string | null
  root_title: string | null
  node_count: number
  created_at: string | null
  updated_at: string | null
}

export interface ListProjectsResponse {
  projects: ProjectListItem[]
}

// ── /api/test-config ──
export interface TestConfigResult {
  llm: ConfigTestEntry
  imggen: ConfigTestEntry
}
export interface ConfigTestEntry {
  ok: boolean
  key_length: number
  model: string
  base_url: string
  error: string | null
  latency_ms: number | null
  sample?: string
}
