import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../api/client'
import { useCopy } from '../../i18n/workspace'
import type { Publication } from '../../types/publications'
import { confirm } from '../shared/ConfirmDialog'
import { Icon } from '../shared/Icon'
import { PublicationVersionList } from '../builder/PublicationVersionList'
import '../builder/publications.css'

/** Publication management survives deletion of its source project. */
export function PublicationLibrary({ onClose }: { onClose: () => void }) {
  const c = useCopy()
  const [publications, setPublications] = useState<Publication[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [manualLink, setManualLink] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const mounted = useRef(true)
  const flight = useRef(false)
  const sequence = useRef(0)
  const close = useRef(onClose)
  close.current = onClose

  const reload = useCallback(async () => {
    const request = ++sequence.current
    setLoading(true)
    setError(null)
    try {
      const result = await api.listAllPublications()
      if (mounted.current && sequence.current === request) setPublications(result.publications)
    } catch (cause) {
      if (mounted.current && sequence.current === request) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mounted.current && sequence.current === request) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    heading.current?.focus()
    void reload()
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('[aria-modal="true"]')) { event.preventDefault(); close.current() }
    }
    window.addEventListener('keydown', escape)
    return () => { mounted.current = false; sequence.current += 1; window.removeEventListener('keydown', escape) }
  }, [reload])

  async function copy(item: Publication) {
    setFeedback(null)
    setManualLink(null)
    try {
      await navigator.clipboard.writeText(item.url)
      if (mounted.current) setFeedback(c('固定版本链接已复制。', 'Fixed version link copied.'))
    } catch { if (mounted.current) setManualLink(item.url) }
  }
  async function withdraw(item: Publication) {
    if (flight.current) return
    const accepted = await confirm({
      title: c('撤下这个固定版本？', 'Withdraw this fixed version?'),
      message: c('这个链接将无法再读取。其他版本和编辑中的作品不受影响；读者已经下载的内容无法追回。', 'This link will stop serving the publication. Other versions and the working project will stay available. Copies readers already downloaded cannot be recalled.'),
      confirmText: c('撤下此版本', 'Withdraw this version'), tone: 'danger',
    })
    if (!accepted || !mounted.current || flight.current) return
    flight.current = true
    sequence.current += 1
    setLoading(false)
    setBusy(true)
    setError(null)
    setFeedback(null)
    setManualLink(null)
    try {
      const result = await api.withdrawPublication(item.project_id, item.id)
      if (!mounted.current) return
      sequence.current += 1
      setPublications((items) => items.map((value) => value.id === item.id ? result.publication : value))
      setFeedback(c('此版本已撤下，原链接已失效。', 'This version has been withdrawn. Its link is no longer available.'))
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally { flight.current = false; if (mounted.current) setBusy(false) }
  }

  return createPortal(<section className="publication-panel publication-library" aria-labelledby="publication-library-title">
    <header className="publication-heading"><h2 ref={heading} tabIndex={-1} id="publication-library-title">{c('发布记录', 'Published versions')}</h2><button type="button" className="icon-button" onClick={onClose} aria-label={c('关闭发布记录', 'Close published versions')}><Icon name="x" size={18} /></button></header>
    <div className="publication-body">
      <p className="publication-intro">{c('管理此实例发布的所有固定版本。删除原作品后，已发布版本仍保留，可在这里单独撤下。', 'Manage all fixed versions published by this instance. Publications remain after their source project is deleted and can be withdrawn here.')}</p>
      <div className="publication-list-heading"><h3>{c('全部固定版本', 'All fixed versions')}</h3><button type="button" className="text-button" disabled={loading || busy} onClick={() => void reload()}>{c('刷新', 'Refresh')}</button></div>
      {loading && <p className="publication-empty" role="status">{c('正在读取发布记录…', 'Loading published versions…')}</p>}
      {error && <div className="publication-error notice notice-error" role="alert"><p>{error}</p><button type="button" className="text-button" disabled={loading || busy} onClick={() => void reload()}>{c('重新查询发布记录', 'Reload publications')}</button></div>}
      {feedback && <p className="publication-feedback" role="status">{feedback}</p>}
      {manualLink && <label className="publication-manual-link">{c('无法自动复制，请复制此固定版本地址：', 'Copy this fixed version address manually:')}<input readOnly value={manualLink} onFocus={(event) => event.currentTarget.select()} /></label>}
      {!loading && !error && !publications.length && <p className="publication-empty">{c('此实例还没有发布记录。打开服务器作品，选择「导出与分享 → 发布固定版本」开始。', 'This instance has no publications yet. Open a server project and choose Export & share → Publish a fixed version.')}</p>}
      {!!publications.length && <PublicationVersionList publications={publications} busy={busy} onCopy={(item) => void copy(item)} onWithdraw={(item) => void withdraw(item)} />}
      <p className="publication-privacy">{c('任何获得固定链接的人都能阅读；随机地址不是访问权限。撤下无法追回已下载的副本。', 'Anyone with a fixed link can read it; a random address is not access control. Withdrawal cannot recall downloaded copies.')}</p>
    </div>
  </section>, document.body)
}
