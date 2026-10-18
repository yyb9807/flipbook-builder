import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ContentMetadata, ContentReference, FlipNode, Hotspot, SceneDocument } from '../../types'
import { newId } from '../../data/exampleProject'
import { useCopy } from '../../i18n/workspace'
import { Icon } from '../shared/Icon'
import { useNodeDraftStore } from '../../store/nodeDraftStore'
import { sectionHotspot } from '../scene/SceneRenderer'
import { ContentProvenance } from '../scene/ContentAttribution'
import { safeReferenceUrl } from '../../utils/sourceUrl'
import { useI18n } from '../../i18n'

export function NodeContentEditor({ node, projectId, local, selectedHotspotId, selectionAction, onSave }: { node: FlipNode; projectId: string; local: boolean; selectedHotspotId?: string | null; selectionAction?: ReactNode; onSave: (patch: Partial<FlipNode>) => Promise<boolean> }) {
  const c = useCopy()
  const { locale } = useI18n()
  const draft = useNodeDraftStore((s) => s.drafts[projectId]?.[node.id])
  const setDraft = useNodeDraftStore((s) => s.setDraft)
  const clearDraft = useNodeDraftStore((s) => s.clearDraft)
  const title = draft?.title ?? node.title
  const description = draft?.description ?? node.description
  const scene = draft ? draft.scene_document : node.scene_document ?? null
  const metadata = draft?.content_metadata ?? node.content_metadata ?? null
  const references = metadata?.references ?? []
  const invalidReferences = references.some((reference) => !reference.title.trim() || !!reference.url && !safeReferenceUrl(reference.url))
  const selectedSectionIndex = scene?.sections.findIndex((section) => (section.hotspot_id ?? section.id) === selectedHotspotId) ?? -1
  const selectedSection = selectedSectionIndex >= 0 ? scene?.sections[selectedSectionIndex] : undefined
  const selectedSectionId = selectedSection?.id
  const sectionElements = useRef(new Map<string, HTMLDivElement>())
  const headingFields = useRef(new Map<string, HTMLInputElement>())
  const [busy, setBusy] = useState(false)
  const dirty = !!draft
  useEffect(() => {
    if (!selectedSectionId) return
    headingFields.current.get(selectedSectionId)?.focus({ preventScroll: true })
    sectionElements.current.get(selectedSectionId)?.scrollIntoView?.({ block: 'nearest' })
  }, [projectId, node.id, selectedSectionId])
  function update(patch: Partial<{ title: string; description: string; scene_document: SceneDocument | null; content_metadata: ContentMetadata }>, resetReview = true) {
    const nextMetadata = patch.content_metadata ?? metadata
    const next = { title, description, scene_document: scene, ...patch, content_metadata: resetReview && nextMetadata ? { ...nextMetadata, review_status: 'unreviewed' as const } : nextMetadata }
    if (next.title === node.title && next.description === node.description && JSON.stringify(next.scene_document) === JSON.stringify(node.scene_document ?? null) && JSON.stringify(next.content_metadata) === JSON.stringify(node.content_metadata ?? null)) clearDraft(projectId, node.id)
    else setDraft(projectId, node.id, next)
  }
  const setTitle = (title: string) => update({ title })
  const setDescription = (description: string) => update({ description })
  const setScene = (scene_document: SceneDocument | null) => update({ scene_document })
  function setReferences(nextReferences: ContentReference[]) {
    update({ content_metadata: { ...(metadata ?? { version: 1, review_status: 'unreviewed' }), references: nextReferences } })
  }
  function changeReference(id: string, patch: Partial<ContentReference>) {
    setReferences(references.map((reference) => reference.id === id ? { ...reference, ...patch } : reference))
  }
  function change(fn: () => void) { fn() }
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!title.trim() || busy || invalidReferences) return
    const submittedDraft = draft
    setBusy(true)
    let hotspots = node.hotspots
    if (local && scene) hotspots = scene.sections.map((section, i): Hotspot => ({
      ...sectionHotspot(node, section, i),
      label: section.title,
    }))
    const nextScene = scene ? { ...scene, sections: scene.sections.map((s, i) => ({ ...s, ...(local ? { hotspot_id: hotspots[i].id } : {}) })) } : null
    const nextMetadata = metadata ? { ...metadata, references: references.map((reference) => ({
      id: reference.id, title: reference.title.trim(), ...(reference.url ? { url: reference.url } : {}), ...(reference.note ? { note: reference.note } : {}),
    })) } : null
    const ok = await onSave({ title: title.trim(), description, scene_document: nextScene, ...(nextMetadata ? { content_metadata: nextMetadata } : {}), ...(local ? { hotspots } : {}) })
    if (ok && useNodeDraftStore.getState().drafts[projectId]?.[node.id] === submittedDraft) clearDraft(projectId, node.id)
    setBusy(false)
  }
  return <form className="content-editor" onSubmit={(e) => void submit(e)}>
    <div className="panel-heading"><h2>{c('页面内容', 'Page content')}</h2>{dirty && <span>{c('未保存', 'Unsaved')}</span>}</div>
    <button className="btn btn-primary content-save" disabled={!dirty || busy || invalidReferences}>{busy ? c('正在保存…', 'Saving…') : c('保存页面内容', 'Save page content')}</button>
    {selectedSection && <p className="content-editor-context">{c('正在编辑区块 ', 'Editing section ') + (selectedSectionIndex + 1)}：{selectedSection.title}</p>}
    <fieldset disabled={busy}>
      <label className="field">{c('标题', 'Title')}<input value={title} maxLength={200} required onChange={(e) => change(() => setTitle(e.target.value))} /></label>
      <label className="field">{c('页面说明', 'Description')}<textarea rows={3} value={description} maxLength={10000} onChange={(e) => change(() => setDescription(e.target.value))} /></label>
      {scene && <>
        <label className="field">{c('版式', 'Layout')}<select value={scene.layout} onChange={(e) => change(() => setScene({ ...scene, layout: e.target.value as SceneDocument['layout'] }))}><option value="atlas">{c('分项图鉴', 'Atlas')}</option><option value="sequence">{c('过程说明', 'Sequence')}</option></select></label>
        {scene.sections.map((section, i) => <div className={`section-editor${section.id === selectedSectionId ? ' is-selected' : ''}`} role="group" aria-label={`${c('内容区块 ', 'Section ') + (i + 1)}：${section.title}`} key={section.id}
          ref={(element) => { if (element) sectionElements.current.set(section.id, element); else sectionElements.current.delete(section.id) }}>
          <div className="section-editor-title"><strong>{c('内容区块 ', 'Section ') + (i + 1)}{section.id === selectedSectionId && <span className="section-editor-selection">{c(' · 已选中', ' · Selected')}</span>}</strong><button type="button" className="icon-button" aria-label={c('移除区块 ', 'Remove section ') + (i + 1)} onClick={() => change(() => setScene({ ...scene, sections: scene.sections.filter((s) => s.id !== section.id) }))}><Icon name="x" /></button></div>
          {section.id === selectedSectionId && selectionAction && <div className="section-branch-action">{selectionAction}</div>}
          <label className="field">{c('小标题', 'Heading')}<input ref={(element) => { if (element) headingFields.current.set(section.id, element); else headingFields.current.delete(section.id) }} maxLength={200} value={section.title} required onChange={(e) => change(() => setScene({ ...scene, sections: scene.sections.map((s) => s.id === section.id ? { ...s, title: e.target.value } : s) }))} /></label>
          <label className="field">{c('解释', 'Explanation')}<textarea rows={3} maxLength={5000} value={section.body} onChange={(e) => change(() => setScene({ ...scene, sections: scene.sections.map((s) => s.id === section.id ? { ...s, body: e.target.value } : s) }))} /></label>
        </div>)}
        <button type="button" className="btn btn-sm" disabled={scene.sections.length >= 12} onClick={() => change(() => setScene({ ...scene, sections: [...scene.sections, { id: newId(), title: c('新要点', 'New idea'), body: '' }] }))}><Icon name="plus" />{c('添加内容区块', 'Add a section')}</button>
      </>}
      <section className="reference-editor" aria-labelledby="reference-editor-title">
        <h3 id="reference-editor-title">{c('参考资料与生成说明', 'References and creation notes')}</h3>
        <ContentProvenance metadata={metadata} locale={locale} />
        <p className="field-hint">{c('填写你使用的书籍、网页或其他资料。系统不会抓取或核验链接，也不表示资料已逐条支持正文。', 'Add books, websites or other materials you used. The system does not fetch or verify links, or check that they support each statement.')}</p>
        {!references.length && <p className="reference-editor-empty">{c('尚未添加参考资料。可以先保存内容，再补充资料。', 'No references yet. You can save the content and add materials later.')}</p>}
        {references.map((reference, index) => {
          const invalidUrl = !!reference.url && !safeReferenceUrl(reference.url)
          const errorId = `reference-url-${reference.id}`
          return <div className="reference-editor-item" role="group" aria-label={c('参考资料 ', 'Reference ') + (index + 1)} key={reference.id}>
            <div className="reference-editor-heading"><strong>{c('参考资料 ', 'Reference ') + (index + 1)}</strong><button type="button" className="icon-button" aria-label={c('移除参考资料 ', 'Remove reference ') + (index + 1)} onClick={() => setReferences(references.filter((item) => item.id !== reference.id))}><Icon name="x" /></button></div>
            <label className="field">{c('资料标题', 'Reference title')}<input value={reference.title} maxLength={200} required onChange={(event) => changeReference(reference.id, { title: event.target.value })} /></label>
            {!reference.title.trim() && <p className="reference-field-error">{c('请填写资料标题。', 'Enter a reference title.')}</p>}
            <label className="field">{c('网页地址（可选）', 'Web address (optional)')}<input type="url" inputMode="url" value={reference.url ?? ''} maxLength={2000} placeholder="https://" aria-invalid={invalidUrl || undefined} aria-describedby={invalidUrl ? errorId : undefined} onChange={(event) => changeReference(reference.id, { url: event.target.value })} /></label>
            {invalidUrl && <p className="reference-field-error" id={errorId} role="alert">{c('请填写完整的 http:// 或 https:// 地址，不含账号、密码或空格。资料仍保留在草稿中。', 'Enter a full http:// or https:// address without credentials or spaces. Your reference remains in the draft.')}</p>}
            <label className="field">{c('资料说明（可选）', 'Reference note (optional)')}<textarea rows={2} value={reference.note ?? ''} maxLength={1000} onChange={(event) => changeReference(reference.id, { note: event.target.value })} /></label>
          </div>
        })}
        <button type="button" className="btn btn-sm" disabled={references.length >= 12} onClick={() => setReferences([...references, { id: newId(), title: '' }])}><Icon name="plus" />{c('添加参考资料', 'Add a reference')}</button>
        <label className="reference-review-toggle"><input type="checkbox" checked={metadata?.review_status === 'reviewed'} onChange={(event) => update({ content_metadata: { ...(metadata ?? { version: 1, references: [] }), review_status: event.target.checked ? 'reviewed' : 'unreviewed' } }, false)} /><span>{c('我已人工核对页面内容和参考资料', 'I have manually reviewed the page and its references')}</span></label>
        <p className="field-hint">{c('这是作者声明。修改内容或资料后，需要重新核对。', 'This is an author declaration. Review again after changing content or references.')}</p>
      </section>
    </fieldset>
  </form>
}
