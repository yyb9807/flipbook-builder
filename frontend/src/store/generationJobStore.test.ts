import { beforeEach, describe, expect, it, vi } from 'vitest'
import { matchesJobSettings, projectGenerationLocked, providerConfig, useGenerationJobStore } from './generationJobStore'
import { DEFAULT_MODEL_SETTINGS, useSettingsStore } from './settingsStore'
import { submitGeneration } from '../hooks/generationJobs'
import type { GenerationJob } from '../types/jobs'
import { useProjectStore } from './projectStore'
import { createExampleProject } from '../data/exampleProject'

vi.mock('../api/client', () => ({ api: { createGenerationJob: vi.fn(), listGenerationJobs: vi.fn() } }))
import { api } from '../api/client'

const config = providerConfig(DEFAULT_MODEL_SETTINGS)
beforeEach(() => {
  useGenerationJobStore.setState({ references: {}, jobs: {}, pending: {}, discovery: {}, connection: {}, syncing: {}, submitting: {}, refreshRevision: 0 })
  useSettingsStore.setState({ ...DEFAULT_MODEL_SETTINGS, llmApiKey: 'never-persist-key', imgGenApiKey: 'never-image-key' })
  vi.clearAllMocks()
  vi.mocked(api.listGenerationJobs).mockResolvedValue({ jobs: [] })
})
describe('generation recovery boundaries', () => {
  it('locks a server workspace until discovery, while local work stays available', () => {
    expect(projectGenerationLocked(useGenerationJobStore.getState(), 'p', 'server')).toBe(true)
    expect(projectGenerationLocked(useGenerationJobStore.getState(), 'p', 'local')).toBe(false)
    useGenerationJobStore.getState().setDiscovery('p', 'ready')
    expect(projectGenerationLocked(useGenerationJobStore.getState(), 'p', 'server')).toBe(false)
  })
  it('requires fresh discovery when returning to the same project instead of trusting an old ready flag', () => {
    const project = createExampleProject()
    useProjectStore.getState().openProject(project, 'server')
    useGenerationJobStore.getState().setDiscovery(project.project_id, 'ready')
    expect(projectGenerationLocked(useGenerationJobStore.getState(), project.project_id, 'server')).toBe(false)
    useProjectStore.getState().resetProject()
    useProjectStore.getState().openProject(project, 'server')
    expect(projectGenerationLocked(useGenerationJobStore.getState(), project.project_id, 'server')).toBe(true)
  })
  it('persists the original operation before sending, then reuses its exact inputs on a lost response', async () => {
    const pending = { operation_id: 'same-operation', project_id: 'p', node_id: 'n', selected_keywords: ['original'], provider_config: config }
    vi.mocked(api.createGenerationJob).mockImplementation(async () => {
      const stored = localStorage.getItem('flipbook-generation-jobs')!
      expect(stored).toContain('same-operation')
      expect(stored).toContain('original')
      expect(stored).not.toContain('never-persist-key')
      expect(stored).not.toContain('never-image-key')
      throw new Error('response lost')
    })
    await expect(submitGeneration(pending)).rejects.toThrow()
    await expect(submitGeneration(useGenerationJobStore.getState().pending.p)).rejects.toThrow()
    expect(api.createGenerationJob).toHaveBeenCalledTimes(2)
    expect(vi.mocked(api.createGenerationJob).mock.calls[1][0]).toEqual(pending)
    useSettingsStore.getState().updateSettings({ llmModel: 'different-model' })
    await expect(submitGeneration(pending)).rejects.toThrow('原来的服务地址和模型')
    expect(api.createGenerationJob).toHaveBeenCalledTimes(2)
  })
  it('does not accept out-of-order events or persist job snapshots / error text', () => {
    const base = { job_id: 'j', operation_id: 'o', project_id: 'p', node_id: 'n', last_event_id: 5, status: 'running', provider_config: config, error: { code: 'E', message: 'never-persist-key' } } as GenerationJob
    useGenerationJobStore.getState().receive(base)
    expect(useGenerationJobStore.getState().receive({ ...base, last_event_id: 4, status: 'cancelled' })).toBe(false)
    expect(useGenerationJobStore.getState().jobs.j.status).toBe('running')
    expect(localStorage.getItem('flipbook-generation-jobs')).not.toContain('never-persist-key')
    expect(localStorage.getItem('flipbook-generation-jobs')).not.toContain('running')
  })
  it('releases an operation rejected by the server instead of leaving a permanent pending lock', async () => {
    const pending = { operation_id: 'rejected', project_id: 'p', node_id: 'n', selected_keywords: [], provider_config: config }
    vi.mocked(api.createGenerationJob).mockRejectedValue(Object.assign(new Error('没有选中热点'), { status: 400 }))
    await expect(submitGeneration(pending)).rejects.toThrow('没有选中热点')
    expect(useGenerationJobStore.getState().pending.p).toBeUndefined()
  })
  it('matches both provider groups before allowing recovery with current keys', () => {
    expect(matchesJobSettings(config)).toBe(true)
    expect(matchesJobSettings({ ...config, imggen_base_url: 'https://different.example/v1' })).toBe(false)
    expect(matchesJobSettings({ ...config, llm_model: 'different' })).toBe(false)
  })
})
