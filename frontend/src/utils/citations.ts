import type { ContentMetadata, ContentReference, SceneDocument } from '../types'
import { safeReferenceUrl } from './sourceUrl'

/** Keep a bounded public copy; provider configuration and arbitrary fields never travel. */
export function publicReference(reference: ContentReference): ContentReference {
  const result: ContentReference = { id: reference.id, title: reference.title }
  const url = reference.url ? safeReferenceUrl(reference.url) : null
  const licenseUrl = reference.license_url ? safeReferenceUrl(reference.license_url) : null
  if (url) result.url = url
  for (const field of ['note', 'excerpt', 'locator', 'source_revision', 'retrieved_at', 'license_title'] as const) {
    if (typeof reference[field] === 'string' && (field === 'excerpt' || reference[field])) result[field] = reference[field]
  }
  if (reference.source_provider === 'wikipedia') result.source_provider = 'wikipedia'
  if (reference.source_language === 'zh' || reference.source_language === 'en') result.source_language = reference.source_language
  if (licenseUrl) result.license_url = licenseUrl
  if (reference.snapshot_sha256 && /^[a-f0-9]{64}$/.test(reference.snapshot_sha256)) result.snapshot_sha256 = reference.snapshot_sha256
  return result
}

export function referenceIdentity(reference: ContentReference): string {
  const { snapshot_sha256: _hash, ...copy } = publicReference(reference)
  return JSON.stringify(Object.fromEntries(Object.entries(copy).sort(([a], [b]) => a.localeCompare(b))))
}

export function citationProblem(scene?: SceneDocument | null, metadata?: ContentMetadata | null): 'missing' | 'limit' | null {
  const ids = new Set((metadata?.references ?? []).map((reference) => reference.id))
  for (const section of scene?.sections ?? []) {
    const references = section.reference_ids ?? []
    if (references.length > 6 || new Set(references).size !== references.length) return 'limit'
    if (references.some((id) => !ids.has(id))) return 'missing'
  }
  return null
}

/** Only the newly retained branch sections need current sources merged into history. */
export function restoreReferenceMetadata(
  scene: SceneDocument | null, historical: ContentMetadata | null,
  current: ContentMetadata | null | undefined, retainedSectionIds: Set<string>,
): ContentMetadata | null {
  let metadata = historical ? structuredClone(historical) : null
  const needed = new Set((scene?.sections ?? []).filter((section) => retainedSectionIds.has(section.id)).flatMap((section) => section.reference_ids ?? []))
  for (const id of needed) {
    const reference = current?.references.find((item) => item.id === id)
    if (!reference) throw new Error('保留分支的参考资料已缺失。请先整理来源。 / A retained branch reference is missing.')
    if (!metadata) metadata = { version: 1, references: [], review_status: 'unreviewed' }
    const existing = metadata.references.find((item) => item.id === id)
    if (existing && referenceIdentity(existing) !== referenceIdentity(reference)) throw new Error('来源版本冲突，请先整理来源再恢复。 / Reference versions conflict. Resolve them before restoring.')
    if (!existing) metadata.references.push(structuredClone(reference))
  }
  if ((metadata?.references.length ?? 0) > 12) throw new Error('恢复后参考资料超过 12 条。 / Restoring would exceed 12 references.')
  if (citationProblem(scene, metadata)) throw new Error('恢复内容的引用关联不完整。 / Restored citations are incomplete.')
  return metadata ? { ...metadata, review_status: 'unreviewed' } : null
}
