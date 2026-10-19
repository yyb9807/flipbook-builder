import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useProjectStore } from '../../store/projectStore'
import { useProjectPublications } from '../../hooks/useProjectPublications'
import { useCopy } from '../../i18n/workspace'
import type { Publication } from '../../types/publications'
import { confirm } from '../shared/ConfirmDialog'
import { Icon } from '../shared/Icon'
import { PublicationVersionList } from './PublicationVersionList'
import './publications.css'

/** A non-modal authoring tool. Published readers never mount this panel. */
export function PublishPanel({ onClose }: { onClose: () => void }) {
  const c = useCopy()
  const project = useProjectStore((state) => state.project)
  const publications = useProjectPublications()
  const heading = useRef<HTMLHeadingElement>(null)
  const alive = useRef(true)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [manualLink, setManualLink] = useState<string | null>(null)
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    alive.current = true
    heading.current?.focus()
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('[aria-modal="true"]')) {
        event.preventDefault()
        close.current()
      }
    }
    window.addEventListener('keydown', escape)
    return () => { alive.current = false; window.removeEventListener('keydown', escape) }
  }, [])

  if (!project) return null
  const published = publications.publications.filter((item) => item.state === 'published')
  const latestRevision = published.reduce<number | null>((latest, item) => latest === null || item.source_revision > latest ? item.source_revision : latest, null)
  const currentPublished = latestRevision !== null && latestRevision === project.revision
  const newSavedChanges = latestRevision !== null && project.revision !== undefined && project.revision > latestRevision

  async function publish(retry = false) {
    setFeedback(null)
    setManualLink(null)
    const result = await (retry ? publications.retry() : publications.publish())
    if (result && alive.current) setFeedback(result.state === 'withdrawn'
      ? c('原发布已确认，但此版本已撤下。核对当前内容后，可发布新版本。', 'The original publication is confirmed, but it has been withdrawn. Review the current content before publishing a new version.')
      : c('固定版本已发布。继续编辑不会改变这个链接中的内容。', 'Fixed version published. Further edits will not change the content at this link.'))
  }
  async function copy(item: Publication) {
    setFeedback(null)
    setManualLink(null)
    try {
      await navigator.clipboard.writeText(item.url)
      if (alive.current) setFeedback(c('固定版本链接已复制。', 'Fixed version link copied.'))
    } catch {
      if (alive.current) setManualLink(item.url)
    }
  }
  async function withdraw(item: Publication) {
    const accepted = await confirm({
      title: c('撤下这个固定版本？', 'Withdraw this fixed version?'),
      message: c('这个链接将无法再读取。其他版本和编辑中的作品不受影响；读者已经下载的内容无法追回。', 'This link will stop serving the publication. Other versions and the working project will stay available. Copies readers already downloaded cannot be recalled.'),
      confirmText: c('撤下此版本', 'Withdraw this version'), tone: 'danger',
    })
    if (!accepted || !alive.current) return
    setFeedback(null)
    setManualLink(null)
    if (await publications.withdraw(item.id) && alive.current) setFeedback(c('此版本已撤下，原链接已失效。', 'This version has been withdrawn. Its link is no longer available.'))
  }

  return createPortal(<section className="publication-panel" aria-labelledby="publication-panel-title">
    <header className="publication-heading">
      <h2 id="publication-panel-title" ref={heading} tabIndex={-1}>{c('发布固定版本', 'Publish a fixed version')}</h2>
      <button type="button" className="icon-button" onClick={onClose} aria-label={c('关闭发布面板', 'Close publication panel')}><Icon name="x" size={18} /></button>
    </header>
    <div className="publication-body">
      <p className="publication-intro">{c('把已保存的整份作品发布为独立只读版本。正文、图片和分支一起固定，后续编辑与页面恢复不会改变旧链接。', 'Publish the saved project as an independent read-only version. Text, images and branches stay fixed, even after later edits or page restoration.')}</p>
      <div className="publication-source">
        <strong>{project.name}</strong>
        <span>{c(`当前保存修订 ${project.revision ?? '—'} · ${Object.keys(project.nodes).length} 页`, `Saved revision ${project.revision ?? '—'} · ${Object.keys(project.nodes).length} pages`)}</span>
        {currentPublished && <p>{c('当前保存内容已有固定版本。再次发布会生成新链接。', 'The saved content already has a fixed version. Publishing again creates a new link.')}</p>}
        {newSavedChanges && <p className="publication-unpublished">{c('有更新的已保存内容尚未发布。旧链接仍保留原内容。', 'New saved changes have not been published. Existing links still show their original content.')}</p>}
      </div>
      {publications.blockReason && <p className="publication-blocked" id="publication-blocked" role="status">{publications.blockReason}</p>}
      {publications.error && <div className="publication-error notice notice-error" role="alert"><p>{publications.error}</p>{!publications.uncertain && <button type="button" className="text-button" disabled={publications.busy || publications.loading} onClick={() => void publications.reload()}>{c('重新查询发布记录', 'Reload publications')}</button>}</div>}
      {publications.uncertain ? <div className="publication-uncertain"><p>{c('上次发布结果待确认。重试会核对同一次发布，不会另建新版本。', 'The previous publication result is unconfirmed. Retry checks the same operation without creating another version.')}</p><button type="button" className="btn btn-primary" disabled={publications.busy || !!publications.blockReason} aria-describedby={publications.blockReason ? 'publication-blocked' : undefined} onClick={() => void publish(true)}>{publications.busy ? c('正在核对…', 'Checking…') : c('查询并重试原发布', 'Check and retry publication')}</button></div>
        : <button type="button" className="btn btn-primary publication-create" disabled={publications.busy || !!publications.blockReason} aria-describedby={publications.blockReason ? 'publication-blocked' : undefined} onClick={() => void publish()}><Icon name="share" />{publications.busy ? c('正在处理…', 'Working…') : c('发布当前保存版本', 'Publish saved version')}</button>}
      {feedback && <p className="publication-feedback" role="status">{feedback}</p>}
      {manualLink && <label className="publication-manual-link">{c('无法自动复制，请复制此固定版本地址：', 'Copy this fixed version address manually:')}<input readOnly value={manualLink} onFocus={(event) => event.currentTarget.select()} /></label>}
      <div className="publication-list-heading"><h3>{c('发布记录', 'Published versions')}</h3><button type="button" className="text-button" disabled={publications.loading || publications.busy} onClick={() => void publications.reload()}>{c('刷新', 'Refresh')}</button></div>
      {publications.loading && <p role="status" className="publication-empty">{c('正在读取发布记录…', 'Loading published versions…')}</p>}
      {!publications.loading && !publications.error && !publications.publications.length && <p className="publication-empty">{c('还没有固定版本。首次发布后，可在这里复制独立阅读地址和管理旧版本。', 'No fixed versions yet. Publish to copy an independent reader link and manage earlier versions here.')}</p>}
      {!!publications.publications.length && <PublicationVersionList publications={publications.publications} busy={publications.busy} onCopy={(item) => void copy(item)} onWithdraw={(item) => void withdraw(item)} />}
      <p className="publication-privacy">{c('任何获得固定链接的人都能阅读；随机地址不是访问权限。阅读需要发布服务在线。撤下无法追回已下载的副本。', 'Anyone with a fixed link can read it; a random address is not access control. The publication service must stay online. Withdrawal cannot recall downloaded copies.')}</p>
    </div>
  </section>, document.body)
}
