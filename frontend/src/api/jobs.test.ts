import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, readJobEvents } from './client'
import { DEFAULT_MODEL_SETTINGS, useSettingsStore } from '../store/settingsStore'
import { providerConfig } from '../store/generationJobStore'

const fetchMock = vi.fn<typeof fetch>()
beforeEach(() => {
  fetchMock.mockReset().mockImplementation(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  useSettingsStore.setState({ ...DEFAULT_MODEL_SETTINGS, llmApiKey: 'local-only-secret', imgGenApiKey: 'image-only-secret' })
})
afterEach(() => vi.unstubAllGlobals())

describe('durable job credentials and SSE', () => {
  it('only explicitly creating or providing credentials sends model headers', async () => {
    const settings = useSettingsStore.getState()
    await api.createGenerationJob({ operation_id: 'operation', project_id: 'p', node_id: 'n', selected_keywords: ['water'], provider_config: providerConfig(settings) }, settings)
    await api.provideGenerationCredentials('j', settings)
    await api.listGenerationJobs('p')
    await api.getGenerationJob('j')
    await api.cancelGenerationJob('j')
    await api.retryGenerationJob('j', 'confirmation')
    await api.acceptGenerationJob('j', 'confirmation')
    fetchMock.mockResolvedValueOnce(new Response('id: 4\ndata: {"last_event_id":4}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }))
    for await (const _event of api.generationJobEvents('j', 3)) { void _event }
    fetchMock.mock.calls.forEach(([, options], index) => {
      const headers = new Headers(options?.headers)
      expect(headers.get('x-llm-api-key')).toBe(index < 2 ? 'local-only-secret' : null)
      expect(headers.get('x-imggen-api-key')).toBe(index < 2 ? 'image-only-secret' : null)
      expect(headers.get('x-llm-base-url')).toBe(index < 2 ? settings.llmBaseUrl : null)
    })
    const last = fetchMock.mock.calls.at(-1)!
    expect(last[0]).toContain('/events?after=3')
    expect(new Headers(last[1]?.headers).get('Last-Event-ID')).toBe('3')
  })

  it('decodes split UTF8, CRLF, comments, multiple data lines and the final unterminated frame', async () => {
    const text = ': heartbeat\r\nid: 7\r\ndata: {"message":"水循环",\r\ndata: "last_event_id":0}\r\n\r\nid: 8\ndata: {"message":"完成","last_event_id":0}'
    const bytes = new TextEncoder().encode(text)
    let offset = 0
    const response = new Response(new ReadableStream({ pull(controller) {
      if (offset === bytes.length) { controller.close(); return }
      controller.enqueue(bytes.slice(offset, ++offset))
    } }))
    const events = []
    for await (const job of readJobEvents(response)) events.push(job)
    expect(events).toEqual([{ message: '水循环', last_event_id: 7 }, { message: '完成', last_event_id: 8 }])
  })
})
