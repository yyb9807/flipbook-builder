import type { AnalyzeStreamDone, GenChildrenStreamDone, RegenerateResponse } from './api'

export type JobStatus = 'queued' | 'running' | 'waiting_credentials' | 'waiting_confirmation' | 'cancelling' | 'succeeded' | 'partial' | 'failed' | 'cancelled'
export type JobKind = 'children' | 'analyze' | 'regenerate'
export interface JobProviderConfig {
  llm_base_url: string
  llm_model: string
  imggen_base_url: string
  imggen_model: string
}
export interface GenerationJob {
  /** Older servers and persisted references represent child generation. */
  kind?: JobKind
  job_id: string
  operation_id: string
  project_id: string
  node_id: string | null
  target_node_id?: string
  input_summary?: { source_type?: string; input_sha256?: string; file_sha256?: string; filename?: string; label?: string; generate_images?: boolean }
  status: JobStatus
  phase: string
  message: string
  pct: number | null
  last_event_id: number
  created_at: string
  updated_at: string
  result: (Omit<GenChildrenStreamDone, 'done'> & Partial<Omit<AnalyzeStreamDone, 'done'>> & Partial<RegenerateResponse>) | null
  error: { code: string; message: string } | null
  provider_config: JobProviderConfig
  required_credentials: ('llm' | 'imggen')[]
  confirmation: { id: string; stage: string; hotspot_id: string | null; message: string; can_accept: boolean; can_retry?: boolean; accept_label: string | null } | null
}
interface PendingBase {
  operation_id: string
  project_id: string
  provider_config: JobProviderConfig
}
export interface PendingChildren extends PendingBase {
  kind?: 'children'
  node_id: string
  selected_keywords: string[]
  generate_images?: boolean
}
export interface PendingAnalysis extends PendingBase {
  kind: 'analyze'
  node_id: null
  text?: string
  keywords?: string
  generate_images: boolean
  file?: { name: string; size: number; type: string; sha256: string }
}
export interface PendingRegeneration extends PendingBase {
  kind: 'regenerate'
  node_id: string
  generate_images: boolean
}
export type PendingGeneration = PendingChildren | PendingAnalysis | PendingRegeneration
export function isTerminalJob(job: GenerationJob) {
  return ['succeeded', 'partial', 'failed', 'cancelled'].includes(job.status)
}
