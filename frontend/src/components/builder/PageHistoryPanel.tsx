import { useEffect, useRef, useState } from 'react'
import { useCopy } from '../../i18n/workspace'
import { useI18n } from '../../i18n'
import type { PageVersionDetail, PageVersionSummary } from '../../types/history'
import { SceneRenderer } from '../scene/SceneRenderer'
import { confirm } from '../shared/ConfirmDialog'

export interface PageHistoryController {
  versions: PageVersionSummary[]
  currentVersionId: string | null
  loading: boolean
  busy: boolean
  error: string | null
  refresh: () => Promise<void>
  getVersion: (id: string) => Promise<PageVersionDetail>
  restoreVersion: (id: string) => Promise<boolean>
  reloadProject?: () => Promise<boolean>
}

export function PageHistoryPanel({ history, disabledReason, reloadDisabledReason, synchronizationError, local, onEditContent }: {
  history: PageHistoryController
  disabledReason?: string | null
  reloadDisabledReason?: string | null
  synchronizationError?: string | null
  local: boolean
  onEditContent: () => void
}) {
  const c = useCopy()
  const { locale } = useI18n()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<PageVersionDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [restored, setRestored] = useState(false)
  const [reloaded, setReloaded] = useState(false)
  const request = useRef(0)
  const previewHeading = useRef<HTMLHeadingElement>(null)
  const previous = history.versions.find((version) => !version.is_current && version.id !== history.currentVersionId)
  const selectedIsCurrent = detail?.version.id === history.currentVersionId || !!history.versions.find((version) => version.id === detail?.version.id)?.is_current
  const blocked = disabledReason || (history.busy ? c('正在恢复页面，请稍候。', 'Restoring the page. Please wait.') : null)
  const reloadBlocked = reloadDisabledReason === undefined ? blocked : reloadDisabledReason || (history.busy ? c('正在恢复页面，请稍候。', 'Restoring the page. Please wait.') : null)
  const displayedError = history.error || synchronizationError
  useEffect(() => { if (detail) previewHeading.current?.scrollIntoView?.({ block: 'nearest' }) }, [detail])

  function dateLabel(value: string) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en', { dateStyle: 'short', timeStyle: 'medium' }).format(date)
  }
  function reasonLabel(reason: string) {
    const labels: Record<string, string> = {
      initial: c('初始记录', 'Initial record'),
      edit: c('页面修改', 'Page edited'),
      hotspot_edit: c('热点或分支修改', 'Hotspot or branch edited'),
      hotspot_added: c('添加热点', 'Hotspot added'),
      branch_create: c('添加子页', 'Page connected'),
      generation: c('生成页面', 'Page generated'),
      restore: c('版本恢复', 'Version restored'),
    }
    return labels[reason] ?? c('页面已保存', 'Page saved')
  }
  async function selectVersion(id: string) {
    const sequence = ++request.current
    setSelectedId(id)
    setDetail(null)
    setDetailLoading(true)
    setDetailError(null)
    setRestored(false)
    setReloaded(false)
    try {
      const loaded = await history.getVersion(id)
      if (sequence === request.current) setDetail(loaded)
    } catch (error) {
      if (sequence === request.current) setDetailError((error as Error).message)
    } finally {
      if (sequence === request.current) setDetailLoading(false)
    }
  }
  async function refresh() {
    setRestored(false)
    setReloaded(false)
    await history.refresh()
    if (selectedId) await selectVersion(selectedId)
  }
  async function reloadProject() {
    if (!history.reloadProject || reloadBlocked) return
    if (await history.reloadProject()) {
      request.current += 1
      setSelectedId(null)
      setDetail(null)
      setDetailLoading(false)
      setDetailError(null)
      setReloaded(true)
    }
  }
  async function restore(id: string) {
    if (blocked || history.busy || detailLoading) return
    try {
      const preview = detail?.version.id === id ? detail : await history.getVersion(id)
      const kept = preview.preserved_branch_count
      const accepted = await confirm({
        title: c('恢复这个页面版本？', 'Restore this page version?'),
        message: c(`恢复前的内容会保留在历史中，已有子页和分支关系会保留${kept ? `（含 ${kept} 个较新的分支）` : ''}。恢复后需要重新人工核对。`, `The previous content will remain in history. Existing pages and branch connections will be kept${kept ? `, including ${kept} newer branches` : ''}. The restored page will need a new manual review.`),
        confirmText: c('恢复此版本', 'Restore this version'),
      })
      if (!accepted) return
      if (await history.restoreVersion(id)) {
        request.current += 1
        setSelectedId(null)
        setDetail(null)
        setDetailError(null)
        setRestored(true)
      }
    } catch (error) { setDetailError((error as Error).message) }
  }

  return <section className="page-history" aria-labelledby="page-history-title">
    <div className="panel-heading"><h2 id="page-history-title">{c('历史版本', 'Page history')}</h2><button type="button" className="text-button" onClick={() => void refresh()} disabled={history.loading || history.busy}>{c('刷新', 'Refresh')}</button></div>
    <p className="panel-description">{c('选择一个已保存版本，先查看恢复后的页面。恢复会保留当前已有子页和分支关系。', 'Choose a saved version to preview the restored page. Existing pages and branch connections will be kept.')}</p>
    <div className="history-actions"><button type="button" className="btn btn-sm" disabled={!previous || history.busy || history.loading || detailLoading} onClick={() => previous && void selectVersion(previous.id)}>{c('预览上一版本', 'Preview previous version')}</button><button type="button" className="text-button" onClick={onEditContent}>{c('返回编辑内容', 'Edit page content')}</button></div>
    {blocked && <p className="history-blocked" id="page-history-blocked" role="status">{blocked}</p>}
    {restored && <p className="history-restored" role="status">{c('页面已恢复。恢复前的内容可在历史版本中找回。', 'Page restored. You can find the previous content in page history.')}</p>}
    {reloaded && <p className="history-restored" role="status">{c('已载入最新保存的作品。请选择版本并重新查看恢复预览。', 'The latest saved project is loaded. Select a version to review its restoration preview again.')}</p>}
    {displayedError && <div className="history-error notice notice-error" role="alert"><span>{displayedError}</span>{history.reloadProject && <><button type="button" className="btn btn-sm" disabled={!!reloadBlocked || history.loading} aria-describedby={reloadBlocked ? 'page-history-reload-blocked' : undefined} onClick={() => void reloadProject()}>{c('重新载入已保存页面', 'Reload saved pages')}</button>{reloadBlocked && <p id="page-history-reload-blocked">{reloadBlocked}</p>}<p>{c('重新载入会读取最新保存的整份作品，之后可重新选择恢复版本。', 'Reload reads the latest saved project. You can then select a version to restore again.')}</p></>}</div>}
    {history.loading && <p className="panel-description" role="status">{c('正在读取版本…', 'Loading saved versions…')}</p>}
    {!history.loading && !history.error && !history.versions.length && <p className="panel-empty">{c('此页还没有历史版本。保存页面内容或修改分支后，可在这里查看和恢复。', 'This page has no saved versions yet. Save page content or edit a branch to start its history.')}</p>}
    {!!history.versions.length && <ol className="history-list" aria-label={c('已保存的页面版本', 'Saved page versions')}>{history.versions.map((version) => <li key={version.id}><button type="button" className="history-version" aria-pressed={selectedId === version.id} disabled={history.busy} onClick={() => void selectVersion(version.id)}>
      <span className="history-version-heading"><strong>{reasonLabel(version.reason)}</strong>{(version.is_current || version.id === history.currentVersionId) && <span>{c('当前版本', 'Current')}</span>}</span>
      <time dateTime={version.created_at}>{dateLabel(version.created_at)}</time>
      <span className="history-version-title">{version.summary.title}</span>
      <span className="history-version-count">{c(`${version.summary.section_count} 个内容区块 · ${version.summary.hotspot_count} 个连接点`, `${version.summary.section_count} sections · ${version.summary.hotspot_count} connections`)}</span>
    </button></li>)}</ol>}
    {detailLoading && <p className="panel-description" role="status">{c('正在准备只读预览…', 'Preparing a read-only preview…')}</p>}
    {detailError && <div className="notice notice-error" role="alert"><span>{detailError}</span><button type="button" className="text-button" onClick={() => selectedId && void selectVersion(selectedId)} disabled={history.busy}>{c('重试', 'Retry')}</button></div>}
    {detail && <section className="history-preview" aria-labelledby="history-preview-title">
      <h3 id="history-preview-title" ref={previewHeading}>{c('恢复结果预览', 'Restoration preview')}</h3>
      <p className="field-hint">{c('只读预览，尚未修改当前页面。', 'This preview is read-only. The current page has not changed.')}</p>
      {detail.preserved_branch_count > 0 && <p className="history-protection">{c(`为保护已有分支，预览保留了 ${detail.preserved_branch_count} 个较新的连接。`, `The preview keeps ${detail.preserved_branch_count} newer connections to protect existing branches.`)}</p>}
      <div className="history-preview-heading"><h4>{detail.preview.title}</h4>{detail.preview.description && <p>{detail.preview.description}</p>}</div>
      <SceneRenderer node={detail.preview} locale={locale} />
      <button type="button" className="btn btn-primary history-restore" disabled={selectedIsCurrent || !!blocked || history.loading} aria-describedby={blocked ? 'page-history-blocked' : undefined} onClick={() => void restore(detail.version.id)}>{selectedIsCurrent ? c('这是当前版本', 'This is the current version') : history.busy ? c('正在恢复…', 'Restoring…') : c('恢复此版本', 'Restore this version')}</button>
    </section>}
    <p className="history-retention">{local ? c('历史保存在此浏览器，每页保留最近 50 个版本。', 'History is kept in this browser, up to 50 versions per page.') : c('历史保存在当前服务器。', 'History is stored on this server.')}{c('导出的作品不包含历史版本；请另外备份。', ' Exported projects do not include history. Keep a separate backup.')}</p>
  </section>
}
