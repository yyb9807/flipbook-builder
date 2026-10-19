import { useEffect, useRef, useState } from 'react'
import type { ContentMetadata, ContentReference, SceneDocument } from '../../types'
import type { SourcePageResult, SourceSearchResult } from '../../types/sources'
import { api } from '../../api/client'
import { newId } from '../../data/exampleProject'
import { useCopy } from '../../i18n/workspace'
import { useI18n } from '../../i18n'
import { safeReferenceUrl } from '../../utils/sourceUrl'
import { Icon } from '../shared/Icon'
import { ContentProvenance } from '../scene/ContentAttribution'
import './sources.css'

interface Props {
  pageTitle: string
  metadata: ContentMetadata | null
  scene: SceneDocument | null
  selectedSectionId?: string
  onChange: (metadata: ContentMetadata, scene: SceneDocument | null, resetReview?: boolean) => void
}

/** Discovery is read-only. Only an explicit add/association action changes the shared page draft. */
export function SourcePanel({ pageTitle, metadata, scene, selectedSectionId, onChange }: Props) {
  const c = useCopy()
  const { locale } = useI18n()
  const [sectionId, setSectionId] = useState(selectedSectionId ?? scene?.sections[0]?.id ?? '')
  const selectedSection = scene?.sections.find((section) => section.id === sectionId)
  const [query, setQuery] = useState(selectedSection?.title || pageTitle)
  const [language, setLanguage] = useState<'zh' | 'en'>(locale)
  const [result, setResult] = useState<SourceSearchResult | null>(null)
  const [preview, setPreview] = useState<SourcePageResult | null>(null)
  const [loading, setLoading] = useState<'search' | 'page' | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [expandedReferences, setExpandedReferences] = useState(() => new Set(
    (metadata?.references ?? [])
      .filter((reference) => !reference.title.trim()
        || !!reference.url && !safeReferenceUrl(reference.url)
        || !!reference.license_url && !safeReferenceUrl(reference.license_url))
      .map((reference) => reference.id),
  ))
  const request = useRef<AbortController | null>(null)
  const requestNumber = useRef(0)
  const previewElement = useRef<HTMLElement>(null)
  const candidateButtons = useRef(new Map<string, HTMLButtonElement>())
  const referenceElements = useRef(new Map<string, HTMLDivElement>())
  const openedCandidate = useRef<string | null>(null)
  const returnFocus = useRef<{ kind: 'candidate' | 'reference'; id: string } | null>(null)
  const references = metadata?.references ?? []
  const baseMetadata: ContentMetadata = metadata ?? { version: 1, references: [], review_status: 'unreviewed' }
  useEffect(() => () => {
    request.current?.abort()
    requestNumber.current += 1
  }, [])
  useEffect(() => {
    const next = returnFocus.current
    const target = preview ? previewElement.current
      : next?.kind === 'candidate' ? candidateButtons.current.get(next.id)
        : next ? referenceElements.current.get(next.id) : null
    if (!target) return
    returnFocus.current = null
    target.focus({ preventScroll: true })
    target.scrollIntoView?.({ block: 'nearest' })
  }, [preview])

  function invalidate() {
    request.current?.abort()
    requestNumber.current += 1
    returnFocus.current = null
    openedCandidate.current = null
    setLoading(null)
    setResult(null)
    setPreview(null)
    setError('')
    setNotice('')
  }
  async function lookup(key?: string) {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    const sequence = ++requestNumber.current
    openedCandidate.current = key ?? null
    setLoading(key ? 'page' : 'search')
    setError('')
    setNotice('')
    setPreview(null)
    if (!key) setResult(null)
    try {
      if (key) {
        const page = await api.getSourcePage(key, language, controller.signal)
        if (sequence === requestNumber.current) setPreview(page)
      } else {
        const found = await api.searchSources(query.trim(), language, controller.signal)
        if (sequence === requestNumber.current) setResult(found)
      }
    } catch (cause) {
      if (sequence === requestNumber.current && !controller.signal.aborted) {
        const code = (cause as { code?: string })?.code
        const messages: Record<string, [string, string]> = {
          source_invalid_response: ['来源返回了无法读取的内容，请稍后重试。', 'The source returned unreadable content. Please retry later.'],
          source_rate_limited: ['来源服务暂时繁忙，请稍后再试。', 'The source service is busy. Please retry later.'],
          source_not_found: ['该条目已不存在，请重新检索。', 'This page no longer exists. Search for another source.'],
          source_too_large: ['来源正文过大，请选择其他条目。', 'This source is too large. Choose another page.'],
          source_timeout: ['来源响应超时，请稍后重试。', 'The source timed out. Please retry later.'],
          source_empty_content: ['该条目没有可读取的正文，请选择其他来源。', 'This page has no readable text. Choose another source.'],
        }
        const message = code && messages[code]
        setError(message ? c(...message) : c('来源服务暂时不可用，请稍后重试或手动添加资料。', 'The source service is unavailable. Retry later or add a reference manually.'))
      }
    } finally {
      if (sequence === requestNumber.current) setLoading(null)
    }
  }
  function changeReferences(next: ContentReference[]) {
    onChange({ ...baseMetadata, references: next }, scene)
  }
  function addManualReference() {
    const id = newId()
    setExpandedReferences((previous) => new Set([...previous, id]))
    changeReferences([...references, { id, title: '' }])
  }
  function editReference(id: string, patch: Partial<ContentReference>) {
    changeReferences(references.map((reference) => {
      if (reference.id !== id) return reference
      const { snapshot_sha256: _oldHash, ...copy } = reference
      return { ...copy, ...patch }
    }))
  }
  function linkReference(id: string, checked: boolean) {
    if (!selectedSection || !scene) return
    const previous = selectedSection.reference_ids ?? []
    if (checked && !previous.includes(id) && previous.length >= 6) {
      setNotice(c('每个区块最多关联 6 条资料，请先解除一条关联。', 'A section can cite up to 6 references. Unlink one first.'))
      return
    }
    const next = checked ? [...new Set([...previous, id])] : previous.filter((value) => value !== id)
    onChange(baseMetadata, { ...scene, sections: scene.sections.map((section) => section.id === selectedSection.id ? { ...section, reference_ids: next } : section) })
    setNotice('')
  }
  function addPreview(link: boolean) {
    if (!preview) return
    const source = preview.reference
    const existing = references.find((reference) => reference.id === source.id
      || reference.url && reference.url === source.url && reference.source_revision === source.source_revision)
    if (!existing && references.length >= 12) {
      setNotice(c('每页最多保留 12 条参考资料。', 'A page can hold up to 12 references.'))
      return
    }
    if (link && selectedSection && (selectedSection.reference_ids?.length ?? 0) >= 6 && !selectedSection.reference_ids?.includes(existing?.id ?? source.id)) {
      setNotice(c('每个区块最多关联 6 条资料，请先解除一条关联。', 'A section can cite up to 6 references. Unlink one first.'))
      return
    }
    const id = existing?.id ?? source.id
    returnFocus.current = { kind: 'reference', id }
    const nextScene = link && selectedSection && scene ? {
      ...scene,
      sections: scene.sections.map((section) => section.id === selectedSection.id
        ? { ...section, reference_ids: [...new Set([...(section.reference_ids ?? []), id])] }
        : section),
    } : scene
    onChange({ ...baseMetadata, references: existing ? references : [...references, source] }, nextScene)
    setPreview(null)
    setResult(null)
    setNotice(link && selectedSection ? c('资料已关联到当前区块。', 'Reference linked to this section.') : c('资料已加入本页资料列表。', 'Reference added to this page’s reference list.'))
  }
  function closePreview() {
    if (openedCandidate.current) returnFocus.current = { kind: 'candidate', id: openedCandidate.current }
    setPreview(null)
  }

  return <section className="sources-panel" aria-label={c('来源与引用', 'Sources and citations')}>
    <p className="sources-intro">{c('找到资料，保留摘录，再关联到正文。检索无需模型或 Key。', 'Find a source, keep an excerpt, and link it to the text. No model or key needed.')}</p>
    {scene?.sections.length ? <label className="field sources-section-picker">{c('关联到内容区块', 'Link to section')}
      <select value={selectedSection?.id ?? ''} onChange={(event) => { setSectionId(event.target.value); setNotice('') }}>
        <option value="">{c('仅作为本页资料', 'Page reference only')}</option>
        {scene.sections.map((section, index) => <option key={section.id} value={section.id}>{index + 1}. {section.title || c('未命名区块', 'Untitled section')}</option>)}
      </select>
    </label> : <p className="field-hint">{c('图片页保存页级资料。添加知识区块后可建立具体引用。', 'Image pages keep page-level references. Knowledge sections can have individual citations.')}</p>}

    <div className="source-discovery" role="search" aria-label={c('检索公开来源', 'Search public sources')}>
      <div className="sources-search-heading"><h3>{c('检索公开来源', 'Search public sources')}</h3><span>{c('维基百科', 'Wikipedia')}</span></div>
      <label className="field">{c('检索词', 'Search terms')}<input type="search" value={query} maxLength={200} onChange={(event) => { invalidate(); setQuery(event.target.value) }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (query.trim().length >= 1) void lookup() } }} placeholder={c('例如：蒸发与水循环', 'For example: evaporation and the water cycle')} /></label>
      <div className="sources-search-controls"><label className="field">{c('来源语言', 'Source language')}<select value={language} onChange={(event) => { invalidate(); setLanguage(event.target.value as 'zh' | 'en') }}><option value="zh">中文</option><option value="en">English</option></select></label>
        <button type="button" className="btn" disabled={!query.trim() || loading !== null} onClick={() => void lookup()}><Icon name="search" />{c('检索', 'Search')}</button></div>
      <p className="field-hint">{c('点击检索时，仅将检索词发送至维基百科。资料是否支持正文，需要你判断。', 'Searching sends only these terms to Wikipedia. You decide whether a source supports the text.')}</p>
      {loading && <p className="sources-feedback" role="status">{loading === 'search' ? c('正在检索公开来源…', 'Searching public sources…') : c('正在读取来源版本与摘录…', 'Reading the source revision and excerpt…')}</p>}
      {error && <div className="sources-error" role="alert"><p>{error}</p><p>{c('已保存资料和页面草稿不受影响。可重试检索，或在下方手动添加。', 'Saved references and page drafts are kept. Retry the search or add a reference below.')}</p></div>}
      {result && !loading && !preview && <div className="source-search-results" aria-label={c('检索结果', 'Search results')}>
        <p className="sources-result-count" role="status">{result.candidates.length ? c(`找到 ${result.candidates.length} 条候选资料`, `${result.candidates.length} source candidates`) : c('没有找到匹配资料。试试更具体的关键词，或切换来源语言。', 'No matching sources. Try more specific terms or choose another source language.')}</p>
        {result.candidates.map((candidate) => <article className="source-candidate" key={candidate.key}>
          <h4>{candidate.title}</h4><span className="source-domain">{language}.wikipedia.org</span><p>{candidate.snippet}</p>
          <div className="source-candidate-actions"><button type="button" className="text-button" ref={(element) => { if (element) candidateButtons.current.set(candidate.key, element); else candidateButtons.current.delete(candidate.key) }} onClick={() => void lookup(candidate.key)}>{c('查看摘录', 'Read excerpt')}</button>{safeReferenceUrl(candidate.url) && <a href={candidate.url} target="_blank" rel="noopener noreferrer">{c('原页面', 'Original page')}</a>}</div>
        </article>)}
      </div>}
      {preview && <section className="source-preview" aria-label={c('来源摘录预览', 'Source excerpt preview')} ref={previewElement} tabIndex={-1}>
        <button type="button" className="text-button" onClick={closePreview}>{c('返回检索结果', 'Back to search results')}</button>
        <h4>{preview.reference.title}</h4><p className="field-hint">{c('来源版本 ', 'Source revision ')}{preview.reference.source_revision}</p>
        <blockquote>{preview.reference.excerpt}</blockquote>
        {preview.truncated && <p className="field-hint">{c('仅保留正文前 3000 字符，并非完整网页。', 'Only the first 3,000 characters are kept, not the complete page.')}</p>}
        {preview.reference.license_title && <p className="field-hint">{c('来源许可：', 'Source license: ')}{preview.reference.license_title}</p>}
        <div className="source-preview-actions">{selectedSection && <button type="button" className="btn btn-sm btn-primary" onClick={() => addPreview(true)}>{c('加入并关联此区块', 'Add and cite in this section')}</button>}<button type="button" className="btn btn-sm" onClick={() => addPreview(false)}>{c('仅加入本页资料', 'Add to page references')}</button></div>
      </section>}
    </div>

    <div className="sources-library-heading"><h3>{c('本页资料', 'Page references')} <span>{references.length}/12</span></h3><button type="button" className="text-button" disabled={references.length >= 12} onClick={addManualReference}><Icon name="plus" />{c('添加参考资料', 'Add a reference')}</button></div>
    {!references.length && <p className="reference-editor-empty">{c('尚未添加参考资料。可以先保存内容，再补充资料。', 'No references yet. You can save the content and add materials later.')}</p>}
    {references.map((reference, index) => {
      const linkedSections = scene?.sections.filter((section) => section.reference_ids?.includes(reference.id)) ?? []
      const invalidUrl = !!reference.url && !safeReferenceUrl(reference.url)
      const errorId = `reference-url-${reference.id}`
      return <div className="reference-editor-item source-library-item" role="group" aria-label={c('参考资料 ', 'Reference ') + (index + 1)} key={reference.id} tabIndex={-1} ref={(element) => { if (element) referenceElements.current.set(reference.id, element); else referenceElements.current.delete(reference.id) }}>
        <div className="reference-editor-heading"><strong>[{index + 1}] {reference.title || c('未命名资料', 'Untitled reference')}</strong><button type="button" className="icon-button" disabled={linkedSections.length > 0} title={linkedSections.length ? c('先解除区块关联，再移除资料', 'Unlink sections before removing this reference') : undefined} aria-label={c('移除参考资料 ', 'Remove reference ') + (index + 1)} onClick={() => changeReferences(references.filter((item) => item.id !== reference.id))}><Icon name="x" /></button></div>
        {selectedSection && <label className="source-link-toggle"><input type="checkbox" checked={selectedSection.reference_ids?.includes(reference.id) ?? false} onChange={(event) => linkReference(reference.id, event.target.checked)} /><span>{c('引用到「', 'Cite in “')}{selectedSection.title}{c('」', '”')}</span></label>}
        <p className="field-hint">{linkedSections.length ? c(`已关联 ${linkedSections.length} 个区块；解除后才能移除。`, `Linked to ${linkedSections.length} sections. Unlink before removing.`) : c('尚未关联正文区块', 'Not linked to a section')}</p>
        <details className="source-reference-fields" open={expandedReferences.has(reference.id)} onToggle={(event) => {
          const open = event.currentTarget.open
          setExpandedReferences((previous) => {
            if (previous.has(reference.id) === open) return previous
            const next = new Set(previous)
            if (open) next.add(reference.id)
            else next.delete(reference.id)
            return next
          })
        }}>
          <summary>{c('编辑资料与摘录', 'Edit reference and excerpt')}</summary>
          <label className="field">{c('资料标题', 'Reference title')}<input value={reference.title} maxLength={200} required onChange={(event) => editReference(reference.id, { title: event.target.value })} /></label>
          {!reference.title.trim() && <p className="reference-field-error">{c('请填写资料标题。', 'Enter a reference title.')}</p>}
          <label className="field">{c('网页地址（可选）', 'Web address (optional)')}<input type="url" inputMode="url" value={reference.url ?? ''} maxLength={2000} placeholder="https://" aria-invalid={invalidUrl || undefined} aria-describedby={invalidUrl ? errorId : undefined} onChange={(event) => editReference(reference.id, { url: event.target.value })} /></label>
          {invalidUrl && <p className="reference-field-error" id={errorId} role="alert">{c('请填写完整的 http:// 或 https:// 地址，不含账号、密码或空格。资料仍保留在草稿中。', 'Enter a full http:// or https:// address without credentials or spaces. Your reference remains in the draft.')}</p>}
          <label className="field">{c('页码或章节（可选）', 'Page or chapter (optional)')}<input value={reference.locator ?? ''} maxLength={200} onChange={(event) => editReference(reference.id, { locator: event.target.value })} /></label>
          <label className="field">{c('保存的来源摘录（可选）', 'Saved source excerpt (optional)')}<textarea rows={5} maxLength={3000} value={reference.excerpt ?? ''} onChange={(event) => editReference(reference.id, { excerpt: event.target.value })} /></label>
          <label className="field">{c('资料说明（可选）', 'Reference note (optional)')}<textarea rows={2} value={reference.note ?? ''} maxLength={1000} onChange={(event) => editReference(reference.id, { note: event.target.value })} /></label>
          {reference.source_revision && <p className="field-hint">{c('记录的来源版本：', 'Recorded source revision: ')}{reference.source_revision}</p>}
          {reference.license_title && <p className="field-hint">{c('来源许可：', 'Source license: ')}{reference.license_title}</p>}
        </details>
      </div>
    })}
    {notice && <p className="sources-feedback" role="status">{notice}</p>}
    <div className="sources-review"><label className="reference-review-toggle"><input type="checkbox" checked={metadata?.review_status === 'reviewed'} onChange={(event) => onChange({ ...baseMetadata, review_status: event.target.checked ? 'reviewed' : 'unreviewed' }, scene, false)} /><span>{c('我已人工核对页面内容和参考资料', 'I have manually reviewed the page and its references')}</span></label><p className="field-hint">{c('这是作者声明。修改内容、摘录或引用后，需要重新核对。', 'This is an author declaration. Review again after changing content, excerpts or citations.')}</p></div>
    <details className="sources-creation-details"><summary>{c('生成说明与来源边界', 'Creation notes and source limits')}</summary><ContentProvenance metadata={metadata} locale={locale} /><p className="field-hint">{c('资料是作者保存的副本，可继续校正；手填网址不会被抓取。系统不自动判断资料是否支持正文，也不会自动标记人工核对。', 'References are editable copies saved by the author. Manually entered URLs are not fetched. The system does not establish support for a claim or mark a human review.')}</p></details>
  </section>
}
