import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './client'
import { providerConfig } from '../store/generationJobStore'
import { DEFAULT_MODEL_SETTINGS, useSettingsStore } from '../store/settingsStore'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  useSettingsStore.setState({ ...DEFAULT_MODEL_SETTINGS, llmApiKey: 'saved-llm-key', imgGenApiKey: 'saved-image-key' })
  fetchMock.mockReset().mockImplementation(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('model credential request scope', () => {
  it('never attaches keys to project reading, editing, deletion, or exports', async () => {
    await api.createProject('test')
    await api.getProject('p1')
    await api.listProjects()
    await api.updateNode('p1', 'n1', { title: 'Edited' })
    await api.updateHotspots('p1', 'n1', [])
    await api.listPageVersions('p1', 'n1')
    await api.getPageVersion('p1', 'n1', 'v1')
    await api.restorePageVersion('p1', 'n1', 'v1', 'operation', 4)
    await api.listPublications('p1')
    await api.listAllPublications()
    await api.createPublication('p1', 'fixed-operation', 4)
    await api.withdrawPublication('p1', 'publication')
    await api.deleteProject('p1')
    await api.exportProjectJson('p1')
    await api.exportProjectZip('p1')
    for (const [, options] of fetchMock.mock.calls) {
      const headers = new Headers(options?.headers)
      expect(headers.has('x-llm-api-key')).toBe(false)
      expect(headers.has('x-imggen-api-key')).toBe(false)
      expect(headers.has('x-llm-base-url')).toBe(false)
    }
  })

  it('sends concurrency revisions and an idempotent restoration identity without model credentials', async () => {
    await api.updateNode('p1', 'n1', { title: 'New', expected_revision: 4 })
    await api.updateHotspots('p1', 'n1', [{ id: 'h', label: 'Idea' }], 5)
    await api.createHotspot('p1', 'n1', { label: 'New', pos_x: .2, pos_y: .3, width: .1, height: .1, expected_revision: 6 })
    await api.restorePageVersion('p1', 'n1', 'v1', 'same-operation', 7)
    expect(fetchMock.mock.calls.map(([, options]) => JSON.parse(options!.body as string).expected_revision)).toEqual([4, 5, 6, 7])
    expect(JSON.parse(fetchMock.mock.calls[3][1]!.body as string)).toEqual({ operation_id: 'same-operation', expected_revision: 7 })
  })

  it('attaches current model settings to analyze and generation operations', async () => {
    const settings = useSettingsStore.getState()
    const common = { operation_id: 'operation', project_id: 'p1', provider_config: providerConfig(settings) }
    await api.createAnalysisJob({ ...common, kind: 'analyze', node_id: null, text: 'subject', generate_images: true }, settings)
    await api.createGenerationJob({ ...common, node_id: 'n1', selected_keywords: [] }, settings)
    await api.createRegenerationJob({ ...common, kind: 'regenerate', node_id: 'n1', generate_images: false }, settings)
    for (const [, options] of fetchMock.mock.calls) {
      const headers = new Headers(options?.headers)
      expect(headers.get('x-llm-api-key')).toBe('saved-llm-key')
      expect(headers.get('x-imggen-api-key')).toBe('saved-image-key')
    }
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).has('Content-Type')).toBe(false)
  })

  it('publishes only the original revision and operation identity, without uploading editor content or runtime', async () => {
    await api.createPublication('p1', 'fixed-operation', 7)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/projects/p1/publications')
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ operation_id: 'fixed-operation', expected_revision: 7 })
    await api.withdrawPublication('p1', 'fixed-version')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/projects/p1/publications/fixed-version')
    expect(fetchMock.mock.calls[1][1]?.method).toBe('DELETE')
    await api.listAllPublications()
    expect(fetchMock.mock.calls[2][0]).toBe('/api/publications')
  })

  it('tests draft credentials without modifying the active or persisted settings', async () => {
    const draft = { ...DEFAULT_MODEL_SETTINGS, llmApiKey: 'draft-only-key', llmBaseUrl: 'https://draft.example/v1' }
    await api.testConfig(draft)
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('x-llm-api-key')).toBe('draft-only-key')
    expect(useSettingsStore.getState().llmApiKey).toBe('saved-llm-key')
    expect(useSettingsStore.getState().llmBaseUrl).toBe(DEFAULT_MODEL_SETTINGS.llmBaseUrl)
    expect(localStorage.getItem('flipbook-settings')).not.toContain('draft-only-key')
  })

  it('streams job events without sending model credentials', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('id: 1\ndata: {"last_event_id":1}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }))
    const events = []
    for await (const event of api.generationJobEvents('j', 0)) events.push(event)
    expect(events).toEqual([{ last_event_id: 1 }])
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).has('x-llm-api-key')).toBe(false)
  })
})
