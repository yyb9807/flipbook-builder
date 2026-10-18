import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachPendingUpload, fileSha256, forgetUploadFile, pendingUploadFile, prepareAnalysis, submitGeneration } from './generationJobs'
import { persistedPending, providerConfig, useGenerationJobStore } from '../store/generationJobStore'
import { DEFAULT_MODEL_SETTINGS, useSettingsStore } from '../store/settingsStore'
import type { GenerationJob, PendingAnalysis } from '../types/jobs'

vi.mock('../api/client', () => ({ api: { listGenerationJobs: vi.fn(), createAnalysisJob: vi.fn(), createGenerationJob: vi.fn(), createRegenerationJob: vi.fn() } }))
import { api } from '../api/client'
const { webcrypto } = await vi.importActual<{ webcrypto: Crypto }>('node:crypto')

function snapshot(pending: PendingAnalysis): GenerationJob {
  return { kind: 'analyze', job_id: 'received-job', operation_id: pending.operation_id, project_id: pending.project_id, node_id: null, target_node_id: 'stable-root',
    status: 'waiting_credentials', phase: 'plan', message: '', pct: 10, last_event_id: 4, created_at: '', updated_at: '', provider_config: pending.provider_config,
    required_credentials: ['llm'], result: null, error: null, confirmation: null }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('crypto', webcrypto)
  useGenerationJobStore.setState({ references: {}, pending: {}, jobs: {}, submitting: {}, connection: {} })
  useSettingsStore.setState({ ...DEFAULT_MODEL_SETTINGS, llmApiKey: 'never-store-llm-key', imgGenApiKey: 'never-store-image-key' })
  vi.mocked(api.listGenerationJobs).mockResolvedValue({ jobs: [] })
})
afterEach(() => vi.unstubAllGlobals())

describe('image submission identity and recovery', () => {
  it('keeps an explicit content-only choice even when image credentials are configured later', async () => {
    const pending = await prepareAnalysis('p', undefined, 'topic', undefined, false)
    useGenerationJobStore.getState().begin(pending)
    useSettingsStore.setState({ imgGenApiKey: 'a-different-image-key' })
    expect(persistedPending(pending)).toEqual(expect.objectContaining({ generate_images: false }))
    vi.mocked(api.createAnalysisJob).mockResolvedValue(snapshot(pending))
    await submitGeneration(pending)
    expect(api.createAnalysisJob).toHaveBeenCalledWith(expect.objectContaining({ generate_images: false }), expect.anything(), undefined)
  })
  it('persists only image metadata and raw hash, with no file bytes or credential fields', async () => {
    const file = new File(['image-byte-canary'], 'original.png', { type: 'image/png' })
    const pending = await prepareAnalysis('p', file, undefined, 'water')
    useGenerationJobStore.getState().begin(pending)
    const saved = localStorage.getItem('flipbook-generation-jobs')!
    expect(saved).toContain(pending.file!.sha256)
    expect(saved).toContain('original.png')
    expect(saved).not.toContain('image-byte-canary')
    expect(saved).not.toContain('never-store-llm-key')
    expect(saved).not.toContain('never-store-image-key')
    expect(pendingUploadFile(pending.operation_id)).toBe(file)
    const polluted = { ...pending, rawFile: file, key: 'unexpected-secret', file: { ...pending.file!, bytes: 'unexpected-secret' } }
    expect(JSON.stringify(persistedPending(polluted))).not.toContain('unexpected-secret')
    forgetUploadFile(pending.operation_id)
  })
  it('recovers a server-accepted operation before needing a file or matching settings', async () => {
    const pending = await prepareAnalysis('p', new File(['image'], 'original.png'))
    forgetUploadFile(pending.operation_id)
    const job = snapshot(pending)
    vi.mocked(api.listGenerationJobs).mockResolvedValue({ jobs: [job] })
    useSettingsStore.setState({ llmModel: 'different-current-model', llmApiKey: '' })
    await submitGeneration(pending)
    expect(api.listGenerationJobs).toHaveBeenCalledWith('p', undefined, false, pending.operation_id)
    expect(api.createAnalysisJob).not.toHaveBeenCalled()
    expect(useGenerationJobStore.getState().jobs[job.job_id]).toEqual(job)
    expect(useGenerationJobStore.getState().pending.p).toBeUndefined()
  })
  it('requires the exact original bytes after reload if the server never accepted the upload', async () => {
    const file = new File(['image-one'], 'original.png')
    const pending = await prepareAnalysis('p', file)
    forgetUploadFile(pending.operation_id)
    await expect(submitGeneration(pending)).rejects.toThrow('原图片')
    expect(api.createAnalysisJob).not.toHaveBeenCalled()
    expect(useGenerationJobStore.getState().pending.p.operation_id).toBe(pending.operation_id)
    await expect(attachPendingUpload(pending, new File(['image-two'], 'original.png'))).rejects.toThrow('不是原提交')
    expect(pendingUploadFile(pending.operation_id)).toBeUndefined()
    // A renamed file with identical bytes is still the same input.
    await attachPendingUpload(pending, new File(['image-one'], 'renamed.png'))
    vi.mocked(api.createAnalysisJob).mockResolvedValue(snapshot(pending))
    await submitGeneration(pending)
    expect(api.createAnalysisJob).toHaveBeenCalledWith(pending, expect.anything(), expect.any(File))
    expect(pendingUploadFile(pending.operation_id)).toBeUndefined()
  })
  it('does not create paid work when the original-operation lookup is unavailable', async () => {
    const pending = await prepareAnalysis('p', undefined, 'topic')
    vi.mocked(api.listGenerationJobs).mockRejectedValue(new Error('offline'))
    await expect(submitGeneration(pending)).rejects.toThrow('offline')
    expect(api.createAnalysisJob).not.toHaveBeenCalled()
    expect(useGenerationJobStore.getState().pending.p.operation_id).toBe(pending.operation_id)
  })
  it('gives an actionable error on insecure HTTP without discarding the file', async () => {
    vi.stubGlobal('crypto', {})
    const file = new File(['image'], 'original.png')
    await expect(fileSha256(file)).rejects.toThrow('HTTPS 或 localhost')
    expect(file.name).toBe('original.png')
  })
  it('normalizes legacy child submissions while retaining their original operation', () => {
    const legacy = { operation_id: 'legacy-operation', project_id: 'p', node_id: 'root', selected_keywords: ['water'], provider_config: providerConfig(DEFAULT_MODEL_SETTINGS) }
    expect(persistedPending(legacy)).toEqual({ ...legacy, kind: 'children' })
  })
})
