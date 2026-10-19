import { describe, expect, it } from 'vitest'
import type { ContentMetadata, ContentReference, SceneDocument } from '../types'
import { citationProblem, publicReference, referenceIdentity, restoreReferenceMetadata } from './citations'

const source: ContentReference = {
  id: 'source', title: 'Water source', url: 'https://en.wikipedia.org/w/index.php?oldid=123',
  note: 'Used to explain evaporation.', excerpt: 'Energy allows water to evaporate.\nA saved second line.', locator: 'Evaporation',
  source_revision: '123', retrieved_at: '2026-10-19T04:00:00+00:00', source_provider: 'wikipedia', source_language: 'en',
  license_title: 'CC BY-SA 4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0/', snapshot_sha256: 'a'.repeat(64),
}
function metadata(references: ContentReference[]): ContentMetadata { return { version: 1, references, review_status: 'reviewed' } }
function scene(referenceIds: string[]): SceneDocument { return { version: 1, layout: 'atlas', sections: [{ id: 'section', title: 'Water', body: 'Explanation', reference_ids: referenceIds }] } }

describe('public reference and citation boundaries', () => {
  it('preserves the saved source copy while excluding request credentials and private fields', () => {
    const input = { ...source, llmApiKey: 'private-key', request: { authorization: 'private-request' } }
    expect(publicReference(input)).toEqual(source)
    expect(input).toHaveProperty('llmApiKey', 'private-key')
    expect(JSON.stringify(publicReference(input))).not.toContain('private-')
  })

  it('preserves an intentionally empty excerpt while removing unsafe URLs and invalid source markers', () => {
    expect(publicReference({ id: 'manual', title: 'Book', excerpt: '', url: 'javascript:alert(1)', license_url: 'https://user:password@example.org/', snapshot_sha256: 'stale', source_provider: 'untrusted', source_language: 'xx' } as never)).toEqual({ id: 'manual', title: 'Book', excerpt: '' })
  })

  it('compares source content independently of object field order and a derived snapshot digest', () => {
    const reordered = Object.fromEntries(Object.entries({ ...source, snapshot_sha256: 'b'.repeat(64) }).reverse()) as unknown as ContentReference
    expect(referenceIdentity(reordered)).toBe(referenceIdentity(source))
    expect(referenceIdentity({ ...source, excerpt: 'A different saved copy.' })).not.toBe(referenceIdentity(source))
    expect(referenceIdentity({ ...source, source_revision: '124' })).not.toBe(referenceIdentity(source))
  })

  it('accepts up to six unique references belonging to the same page and remains compatible with older content', () => {
    const references = Array.from({ length: 6 }, (_, index) => ({ id: `ref-${index}`, title: `Reference ${index}` }))
    expect(citationProblem(scene(references.map((reference) => reference.id)), metadata(references))).toBeNull()
    expect(citationProblem(null, null)).toBeNull()
    expect(citationProblem({ version: 1, layout: 'atlas', sections: [{ id: 'old', title: 'Old page', body: 'No citations yet.' }] }, null)).toBeNull()
  })

  it.each([
    { name: 'a missing source', ids: ['missing'], expected: 'missing' },
    { name: 'a duplicated association', ids: ['source', 'source'], expected: 'limit' },
    { name: 'more than six associations', ids: Array.from({ length: 7 }, (_, index) => `ref-${index}`), expected: 'limit' },
  ])('rejects $name before saving or exporting', ({ ids, expected }) => {
    expect(citationProblem(scene(ids), metadata([source]))).toBe(expected)
  })
})

describe('reference restoration limits', () => {
  it('refuses a retained branch whose source copy is missing without changing either input', () => {
    const content = scene(['source'])
    const old = metadata([{ id: 'book', title: 'An older book' }])
    const current = metadata([])
    const before = JSON.stringify([content, old, current])
    expect(() => restoreReferenceMetadata(content, old, current, new Set(['section']))).toThrow('保留分支的参考资料已缺失')
    expect(JSON.stringify([content, old, current])).toBe(before)
  })

  it('refuses to merge a thirteenth source rather than dropping historical or retained-branch references', () => {
    const old = metadata(Array.from({ length: 12 }, (_, index) => ({ id: `old-${index}`, title: `Historical ${index}` })))
    const current = metadata([source])
    const before = JSON.stringify([old, current])
    expect(() => restoreReferenceMetadata(scene(['source']), old, current, new Set(['section']))).toThrow('12')
    expect(JSON.stringify([old, current])).toBe(before)
  })

  it('does not import unrelated current sources and rejects dangling historical associations', () => {
    const old = metadata([{ id: 'book', title: 'Historical book' }])
    const restored = restoreReferenceMetadata(scene(['book']), old, metadata([source]), new Set())
    expect(restored).toEqual({ ...old, review_status: 'unreviewed' })
    expect(restored).not.toBe(old)
    expect(() => restoreReferenceMetadata(scene(['missing']), old, metadata([source]), new Set())).toThrow('引用关联不完整')
    expect(old.review_status).toBe('reviewed')
  })
})
