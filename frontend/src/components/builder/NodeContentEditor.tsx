import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ContentMetadata, FlipNode, Hotspot, SceneDocument } from '../../types'
import { newId } from '../../data/exampleProject'
import { useCopy } from '../../i18n/workspace'
import { Icon } from '../shared/Icon'
import { useNodeDraftStore } from '../../store/nodeDraftStore'
import { sectionHotspot } from '../scene/SceneRenderer'
import { safeReferenceUrl } from '../../utils/sourceUrl'
import { confirm } from '../shared/ConfirmDialog'
import { SourcePanel } from './SourcePanel'
import { citationProblem, publicReference } from '../../utils/citations'

export function NodeContentEditor({ node, projectId, local, selectedHotspotId, selectionAction, onSave, onShowHistory, onShowSources, mode = 'all' }: { node: FlipNode; projectId: string; local: boolean; selectedHotspotId?: string | null; selectionAction?: ReactNode; onSave: (patch: Partial<FlipNode>) => Promise<boolean>; onShowHistory?: () => void; onShowSources?: () => void; mode?: 'all' | 'content' | 'sources' }) {
  const c = useCopy()
  const draft = useNodeDraftStore((s) => s.drafts[projectId]?.[node.id])
  const setDraft = useNodeDraftStore((s) => s.setDraft)
  const clearDraft = useNodeDraftStore((s) => s.clearDraft)
  const title = draft?.title ?? node.title
  const description = draft?.description ?? node.description
  const scene = draft ? draft.scene_document : node.scene_document ?? null
  const metadata = draft?.content_metadata ?? node.content_metadata ?? null
  const references = metadata?.references ?? []
  const invalidCitations = citationProblem(scene, metadata)
  const invalidReferences = references.some((reference) => !reference.title.trim() || !!reference.url && !safeReferenceUrl(reference.url) || !!reference.license_url && !safeReferenceUrl(reference.license_url)) || !!invalidCitations
  const selectedSectionIndex = scene?.sections.findIndex((section) => (section.hotspot_id ?? section.id) === selectedHotspotId) ?? -1
  const selectedSection = selectedSectionIndex >= 0 ? scene?.sections[selectedSectionIndex] : undefined
  const selectedSectionId = selectedSection?.id
  const sectionElements = useRef(new Map<string, HTMLDivElement>())
  const headingFields = useRef(new Map<string, HTMLInputElement>())
  const [busy, setBusy] = useState(false)
  const dirty = !!draft
  useEffect(() => {
    if (mode === 'sources' || !selectedSectionId) return
    headingFields.current.get(selectedSectionId)?.focus({ preventScroll: true })
    sectionElements.current.get(selectedSectionId)?.scrollIntoView?.({ block: 'nearest' })
  }, [projectId, node.id, selectedSectionId, mode])
  function update(patch: Partial<{ title: string; description: string; scene_document: SceneDocument | null; content_metadata: ContentMetadata }>, resetReview = true) {
    const nextMetadata = patch.content_metadata ?? metadata
    const next = { title, description, scene_document: scene, ...patch, content_metadata: resetReview && nextMetadata ? { ...nextMetadata, review_status: 'unreviewed' as const } : nextMetadata }
    if (next.title === node.title && next.description === node.description && JSON.stringify(next.scene_document) === JSON.stringify(node.scene_document ?? null) && JSON.stringify(next.content_metadata) === JSON.stringify(node.content_metadata ?? null)) clearDraft(projectId, node.id)
    else setDraft(projectId, node.id, next)
  }
  const setTitle = (title: string) => update({ title })
  const setDescription = (description: string) => update({ description })
  const setScene = (scene_document: SceneDocument | null) => update({ scene_document })
  async function discardDraft() {
    const discardedDraft = useNodeDraftStore.getState().drafts[projectId]?.[node.id]
    if (!discardedDraft || busy) return
    const accepted = await confirm({
      title: c('撤回当前页的未保存修改？', 'Discard unsaved changes on this page?'),
      message: c('当前页将回到保存后的内容。已有分支、历史版本和其他页面的草稿都会保留。', 'This page will return to its saved content. Existing branches, saved versions and drafts on other pages will be kept.'),
      confirmText: c('撤回本次修改', 'Discard these changes'),
    })
    if (accepted && useNodeDraftStore.getState().drafts[projectId]?.[node.id] === discardedDraft) clearDraft(projectId, node.id)
  }
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
    const nextMetadata = metadata ? { ...metadata, references: references.map((reference) => publicReference({ ...reference, title: reference.title.trim() })) } : null
    const ok = await onSave({ title: title.trim(), description, scene_document: nextScene, ...(nextMetadata ? { content_metadata: nextMetadata } : {}), ...(local ? { hotspots } : {}) })
    if (ok && useNodeDraftStore.getState().drafts[projectId]?.[node.id] === submittedDraft) clearDraft(projectId, node.id)
    setBusy(false)
  }
  return <form className="content-editor" onSubmit={(e) => void submit(e)}>
    <div className="panel-heading"><h2>{mode === 'sources' ? c('来源与引用', 'Sources and citations') : c('页面内容', 'Page content')}</h2>{dirty && <span>{c('未保存', 'Unsaved')}</span>}</div>
    <div className="content-save-bar"><button className="btn btn-primary content-save" disabled={!dirty || busy || invalidReferences}>{busy ? c('正在保存…', 'Saving…') : mode === 'sources' ? c('保存页面与引用', 'Save page and citations') : c('保存页面内容', 'Save page content')}</button></div>
    <div className="content-recovery-actions">
      {dirty && <button type="button" className="text-button" disabled={busy} onClick={() => void discardDraft()}>{c('撤回本次修改', 'Discard these changes')}</button>}
      {onShowHistory && <button type="button" className="text-button" onClick={onShowHistory}>{c('查看历史版本', 'View page history')}</button>}
    </div>
    {mode !== 'sources' && selectedSection && <p className="content-editor-context">{c('正在编辑区块 ', 'Editing section ') + (selectedSectionIndex + 1)}：{selectedSection.title}</p>}
    {invalidReferences && (mode === 'content' || !!invalidCitations) && <p className="reference-field-error" role="alert">{c('请在来源面板补全资料标题、有效链接和引用关联后保存。', 'Complete reference titles, valid links and citation relationships before saving.')}</p>}
    <fieldset disabled={busy}>
      {mode !== 'sources' && <>
      <label className="field">{c('标题', 'Title')}<input value={title} maxLength={200} required onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="field">{c('页面说明', 'Description')}<textarea rows={3} value={description} maxLength={10000} onChange={(e) => setDescription(e.target.value)} /></label>
      {scene && <>
        <label className="field">{c('版式', 'Layout')}<select value={scene.layout} onChange={(e) => setScene({ ...scene, layout: e.target.value as SceneDocument['layout'] })}><option value="atlas">{c('分项图鉴', 'Atlas')}</option><option value="sequence">{c('过程说明', 'Sequence')}</option></select></label>
        {scene.sections.map((section, i) => <div className={`section-editor${section.id === selectedSectionId ? ' is-selected' : ''}`} role="group" aria-label={`${c('内容区块 ', 'Section ') + (i + 1)}：${section.title}`} key={section.id}
          ref={(element) => { if (element) sectionElements.current.set(section.id, element); else sectionElements.current.delete(section.id) }}>
          <div className="section-editor-title"><strong>{c('内容区块 ', 'Section ') + (i + 1)}{section.id === selectedSectionId && <span className="section-editor-selection">{c(' · 已选中', ' · Selected')}</span>}</strong><button type="button" className="icon-button" aria-label={c('移除区块 ', 'Remove section ') + (i + 1)} disabled={!!sectionHotspot(node, section, i).target_node_id} aria-describedby={sectionHotspot(node, section, i).target_node_id ? `section-branch-protection-${section.id}` : undefined} onClick={() => setScene({ ...scene, sections: scene.sections.filter((s) => s.id !== section.id) })}><Icon name="x" /></button></div>
          {sectionHotspot(node, section, i).target_node_id && <p className="field-hint" id={`section-branch-protection-${section.id}`}>{c('此区块已连接子页，保留区块可保护分支关系。', 'This section is connected to a page. It is kept to protect that branch.')}</p>}
          {section.id === selectedSectionId && selectionAction && <div className="section-branch-action">{selectionAction}</div>}
          <label className="field">{c('小标题', 'Heading')}<input ref={(element) => { if (element) headingFields.current.set(section.id, element); else headingFields.current.delete(section.id) }} maxLength={200} value={section.title} required onChange={(e) => setScene({ ...scene, sections: scene.sections.map((s) => s.id === section.id ? { ...s, title: e.target.value } : s) })} /></label>
          <label className="field">{c('解释', 'Explanation')}<textarea rows={3} maxLength={5000} value={section.body} onChange={(e) => setScene({ ...scene, sections: scene.sections.map((s) => s.id === section.id ? { ...s, body: e.target.value } : s) })} /></label>
        </div>)}
        <button type="button" className="btn btn-sm" disabled={scene.sections.length >= 12} onClick={() => setScene({ ...scene, sections: [...scene.sections, { id: newId(), title: c('新要点', 'New idea'), body: '' }] })}><Icon name="plus" />{c('添加内容区块', 'Add a section')}</button>
      </>}
      {mode === 'content' && onShowSources && <button type="button" className="btn content-sources-link" onClick={onShowSources}><Icon name="link" />{c('管理来源与引用', 'Manage sources and citations')}</button>}
      </>}
      {mode !== 'content' && <SourcePanel key={projectId + ':' + node.id} pageTitle={title} metadata={metadata} scene={scene} selectedSectionId={selectedSectionId}
        onChange={(content_metadata, scene_document, resetReview = true) => update({ content_metadata, scene_document }, resetReview)} />}
    </fieldset>
  </form>
}
