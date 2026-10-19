import { afterEach, describe, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import type { Project } from '../types'
import { createOfflineHtml, createOfflineZip, publicationHtml, publicationSnapshot } from './offlineExport'

vi.mock('virtual:offline-player', () => ({ playerJs: 'window.offlinePlayer = true;', playerCss: '.project-viewer{display:block}' }))

function project(): Project {
  return {
    project_id: 'local-demo', name: '</title><script>alert(1)</script>', root_node_id: 'root',
    settings: { max_depth: 4, max_hotspots_per_page: 3, visual_style: 'atlas', language: 'zh', apiKey: 'secret-key' } as Project['settings'],
    nodes: { root: {
      id: 'root', parent_id: null, depth: 0, title: '</script><script>alert(2)</script>', description: 'A & B', source_type: 'text', image_url: null, children: ['missing'], hotspots: [], status: 'draft',
      scene_document: { version: 1, layout: 'atlas', sections: [{ id: 'one', title: '一个主题', body: '可编辑文字', target_node_id: 'missing' }] },
      apiKey: 'node-secret',
    } as Project['nodes'][string] },
    llmApiKey: 'project-secret',
  } as Project
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('offline publication boundary', () => {
  it('allowlists content and removes unknown configuration and broken links', () => {
    const snapshot = publicationSnapshot(project())
    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toContain('secret')
    expect(snapshot.nodes.root.children).toEqual([])
    expect(snapshot.nodes.root.scene_document!.sections[0].target_node_id).toBeUndefined()
    expect(snapshot.nodes.root.scene_document!.sections[0].body).toBe('可编辑文字')
  })

  it('preserves author references, genuine model provenance and section connections without execution fields', () => {
    const work = project()
    work.nodes.root.hotspots = [{ id: 'section-link', kind: 'section', label: 'Explore', selected: true, target_node_id: null, position: null, size: null, score: null }]
    work.nodes.root.content_metadata = {
      version: 1, review_status: 'reviewed',
      provenance: { kind: 'ai', input_kind: 'text', model: 'content-model', base_url: 'secret-endpoint' } as never,
      references: [
        { id: 'book', title: 'Water reference', url: 'https://example.org/water', note: 'Chapter 2', apiKey: 'secret-ref' } as never,
        { id: 'unsafe', title: 'A reference without a safe link', url: 'javascript:alert(1)' },
      ],
      credentials: 'secret-metadata',
    } as never
    const snapshot = publicationSnapshot(work)
    expect(snapshot.nodes.root.hotspots[0]).toEqual({ id: 'section-link', kind: 'section', label: 'Explore', position: null, size: null, selected: false, target_node_id: null })
    expect(snapshot.nodes.root.content_metadata).toEqual({
      version: 1, review_status: 'reviewed', provenance: { kind: 'ai', input_kind: 'text', model: 'content-model' },
      references: [{ id: 'book', title: 'Water reference', url: 'https://example.org/water', note: 'Chapter 2' }, { id: 'unsafe', title: 'A reference without a safe link' }],
    })
    expect(JSON.stringify(snapshot)).not.toContain('secret')
  })

  it('keeps adversarial titles and content inside inert JSON and escaped HTML', () => {
    const snapshot = publicationSnapshot(project())
    const html = publicationHtml(snapshot, { playerJs: '', playerCss: '' }, false)
    const document = new DOMParser().parseFromString(html, 'text/html')
    expect(document.querySelectorAll('script')).toHaveLength(2)
    expect(document.title).toBe(snapshot.name)
    const embedded = JSON.parse(document.getElementById('flipbook-data')!.textContent!)
    expect(embedded.nodes.root.title).toBe(snapshot.nodes.root.title)
    expect(html).not.toContain('<script>alert(')
    expect(html).not.toContain('type="module"')
    expect(html).not.toContain('fetch(')
  })

  it('makes a complete zip with a classic player, content and local image resources', async () => {
    const work = project()
    work.nodes.root.content_metadata = { version: 1, references: [{
      id: 'ref', title: 'Water book', url: 'https://en.wikipedia.org/w/index.php?oldid=123', note: 'Author-selected source.',
      excerpt: '水吸收热量后可以蒸发。\n</script><img src=x onerror=bad()>', locator: 'Evaporation',
      source_revision: '123', retrieved_at: '2026-10-19T04:00:00+00:00', source_provider: 'wikipedia', source_language: 'en',
      license_title: 'CC BY-SA 4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0/', snapshot_sha256: 'a'.repeat(64),
    }], review_status: 'unreviewed' }
    work.nodes.root.scene_document!.sections[0].reference_ids = ['ref']
    work.nodes.root.image_url = '/illustration.png'
    const fetch = vi.fn().mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'image/png' }), arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer })
    vi.stubGlobal('fetch', fetch)
    const files = unzipSync(await blobBytes(await createOfflineZip(work)))
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['index.html', 'player.js', 'player.css', 'project.json', 'images/image-1.png']))
    expect(strFromU8(files['player.js'])).toBe('window.offlinePlayer = true;')
    expect(strFromU8(files['project.json'])).toContain('images/image-1.png')
    expect(strFromU8(files['project.json'])).not.toContain('secret')
    const exported = JSON.parse(strFromU8(files['project.json']))
    expect(exported.nodes.root.content_metadata).toEqual(work.nodes.root.content_metadata)
    expect(exported.nodes.root.scene_document.sections[0].reference_ids).toEqual(['ref'])
    const html = new DOMParser().parseFromString(strFromU8(files['index.html']), 'text/html')
    const embedded = JSON.parse(html.getElementById('flipbook-data')!.textContent!)
    expect(embedded).toEqual(exported)
    expect(html.querySelector('img')).toBeNull()
    expect(html.querySelectorAll('script')).toHaveLength(2)
    expect(strFromU8(files['index.html'])).toContain('Water book')
    expect(strFromU8(files['index.html'])).toContain('<script src="player.js">')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/illustration.png'), { credentials: 'omit' })
    expect(work.nodes.root.image_url).toBe('/illustration.png')
    work.nodes.root.content_metadata.references[0].excerpt = 'Changed after exporting.'
    work.nodes.root.scene_document!.sections[0].reference_ids.length = 0
    expect(exported.nodes.root.content_metadata.references[0].excerpt).toContain('水吸收热量')
    expect(exported.nodes.root.scene_document.sections[0].reference_ids).toEqual(['ref'])
  })

  it.each([
    { reason: 'dangling', ids: ['missing'] },
    { reason: 'duplicated', ids: ['ref', 'ref'] },
    { reason: 'over-limit', ids: Array.from({ length: 7 }, (_, index) => `ref-${index}`) },
  ])('rejects $reason citations before fetching publication assets', async ({ ids }) => {
    const work = project()
    work.nodes.root.image_url = '/illustration.png'
    work.nodes.root.content_metadata = { version: 1, references: [{ id: 'ref', title: 'Saved reference' }], review_status: 'unreviewed' }
    work.nodes.root.scene_document!.sections[0].reference_ids = ids
    const before = JSON.stringify(work)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(() => publicationSnapshot(work)).toThrow('引用关联')
    await expect(createOfflineZip(work)).rejects.toThrow('引用关联')
    expect(fetch).not.toHaveBeenCalled()
    expect(JSON.stringify(work)).toBe(before)
  })

  it('inlines image data in standalone HTML and reports unavailable images', async () => {
    const work = project()
    work.nodes.root.image_url = '/illustration.png'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'image/png' }), arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer }))
    expect(await createOfflineHtml(work)).toContain('data:image/png;base64,iVBORw==')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    await expect(createOfflineZip(work)).rejects.toThrow('图片下载失败')
  })
})
