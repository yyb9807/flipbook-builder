import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { sameEndpoint, useSettingsStore, type ModelSettings } from './settingsStore'
import { getWorkspaceRevision, type ProjectOrigin } from './projectStore'
import { isTerminalJob, type GenerationJob, type JobKind, type JobProviderConfig, type PendingGeneration } from '../types/jobs'

interface JobReference { job_id: string; operation_id: string; project_id: string; node_id: string | null; kind?: JobKind; last_event_id: number }

/** File objects and accidental model credentials must never enter durable client state. */
export function persistedPending(pending: PendingGeneration): PendingGeneration {
  const common = { operation_id: pending.operation_id, project_id: pending.project_id, provider_config: {
    llm_base_url: pending.provider_config.llm_base_url, llm_model: pending.provider_config.llm_model,
    imggen_base_url: pending.provider_config.imggen_base_url, imggen_model: pending.provider_config.imggen_model,
  } }
  if (pending.kind === 'analyze') return { ...common, kind: 'analyze', node_id: null, generate_images: pending.generate_images,
    ...(pending.text ? { text: pending.text } : {}), ...(pending.keywords ? { keywords: pending.keywords } : {}),
    ...(pending.file ? { file: { name: pending.file.name, size: pending.file.size, type: pending.file.type, sha256: pending.file.sha256 } } : {}) }
  if (pending.kind === 'regenerate') return { ...common, kind: 'regenerate', node_id: pending.node_id, generate_images: pending.generate_images }
  return { ...common, kind: 'children', node_id: pending.node_id, selected_keywords: [...pending.selected_keywords], ...(pending.generate_images !== undefined ? { generate_images: pending.generate_images } : {}) }
}
interface GenerationState {
  references: Record<string, JobReference>
  pending: Record<string, PendingGeneration>
  jobs: Record<string, GenerationJob>
  discovery: Record<string, 'loading' | 'ready' | 'error'>
  checkedRevision: Record<string, number>
  connection: Record<string, string | null>
  submitting: Record<string, boolean>
  syncing: Record<string, boolean>
  refreshRevision: number
  begin: (pending: PendingGeneration) => void
  clearPending: (projectId: string) => void
  receive: (job: GenerationJob) => boolean
  setDiscovery: (projectId: string, state: 'loading' | 'ready' | 'error', revision?: number) => void
  setConnection: (projectId: string, message: string | null) => void
  setSubmitting: (projectId: string, value: boolean) => void
  setSyncing: (projectId: string, value: boolean) => void
  refresh: () => void
}

export const useGenerationJobStore = create<GenerationState>()(persist((set, get) => ({
  references: {}, pending: {}, jobs: {}, discovery: {}, checkedRevision: {}, connection: {}, submitting: {}, syncing: {}, refreshRevision: 0,
  begin: (pending) => set((state) => ({ pending: { ...state.pending, [pending.project_id]: pending } })),
  clearPending: (projectId) => set((state) => ({ pending: Object.fromEntries(Object.entries(state.pending).filter(([id]) => id !== projectId)) })),
  receive: (job) => {
    const previous = get().jobs[job.job_id]
    if (previous && previous.last_event_id > job.last_event_id) return false
    set((state) => {
      const pending = { ...state.pending }
      if (pending[job.project_id]?.operation_id === job.operation_id) delete pending[job.project_id]
      return {
        jobs: { ...state.jobs, [job.job_id]: job }, pending,
        syncing: isTerminalJob(job) && previous?.last_event_id !== job.last_event_id ? { ...state.syncing, [job.project_id]: true } : state.syncing,
        references: { ...state.references, [job.job_id]: { job_id: job.job_id, operation_id: job.operation_id, project_id: job.project_id, node_id: job.node_id, kind: job.kind ?? 'children', last_event_id: job.last_event_id } },
      }
    })
    return true
  },
  setDiscovery: (projectId, value, revision = getWorkspaceRevision()) => set((state) => ({ discovery: { ...state.discovery, [projectId]: value }, checkedRevision: value === 'ready' ? { ...state.checkedRevision, [projectId]: revision } : state.checkedRevision })),
  setConnection: (projectId, value) => set((state) => ({ connection: { ...state.connection, [projectId]: value } })),
  setSubmitting: (projectId, value) => set((state) => ({ submitting: { ...state.submitting, [projectId]: value } })),
  setSyncing: (projectId, value) => set((state) => ({ syncing: { ...state.syncing, [projectId]: value } })),
  refresh: () => set((state) => ({ refreshRevision: state.refreshRevision + 1 })),
}), {
  name: 'flipbook-generation-jobs', version: 2,
  // Strict allowlist. Neither model keys, provider exceptions nor snapshots are persisted.
  partialize: (state) => ({ references: state.references, pending: Object.fromEntries(Object.entries(state.pending).map(([id, pending]) => [id, persistedPending(pending)])) }),
  migrate: (saved) => {
    const state = saved as Partial<GenerationState>
    return { references: state.references ?? {}, pending: Object.fromEntries(Object.entries(state.pending ?? {}).map(([id, pending]) => [id, persistedPending(pending)])) }
  },
  merge: (saved, current) => {
    const persisted = saved as Partial<GenerationState> | null
    return { ...current, references: persisted?.references ?? {}, pending: Object.fromEntries(Object.entries(persisted?.pending ?? {}).map(([id, pending]) => [id, persistedPending(pending)])) }
  },
}))

export function providerConfig(settings: ModelSettings): JobProviderConfig {
  return { llm_base_url: settings.llmBaseUrl, llm_model: settings.llmModel, imggen_base_url: settings.imgGenBaseUrl, imggen_model: settings.imgGenModel }
}
export function matchesJobSettings(config: JobProviderConfig, settings: ModelSettings = useSettingsStore.getState()) {
  return sameEndpoint(config.llm_base_url, settings.llmBaseUrl) && config.llm_model === settings.llmModel
    && sameEndpoint(config.imggen_base_url, settings.imgGenBaseUrl) && config.imggen_model === settings.imgGenModel
}
export function currentProjectJob(state: GenerationState, projectId: string): GenerationJob | null {
  const jobs = Object.values(state.jobs).filter((job) => job.project_id === projectId)
  return jobs.sort((a, b) => Number(isTerminalJob(a)) - Number(isTerminalJob(b)) || b.created_at.localeCompare(a.created_at))[0] ?? null
}
export function projectGenerationLocked(state: GenerationState, projectId: string | undefined, origin: ProjectOrigin): boolean {
  if (!projectId || origin !== 'server') return false
  return state.discovery[projectId] !== 'ready' || state.checkedRevision[projectId] !== getWorkspaceRevision() || Boolean(state.pending[projectId] || state.submitting[projectId] || state.syncing[projectId])
    || Object.values(state.jobs).some((job) => job.project_id === projectId && !isTerminalJob(job))
}
