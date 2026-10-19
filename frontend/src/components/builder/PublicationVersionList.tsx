import { useCopy } from '../../i18n/workspace'
import { useI18n } from '../../i18n'
import type { Publication } from '../../types/publications'
import { Icon } from '../shared/Icon'

/** Identical receipts and reader actions in the workspace and the global library. */
export function PublicationVersionList({ publications, busy, onCopy, onWithdraw }: {
  publications: Publication[]
  busy: boolean
  onCopy: (publication: Publication) => void
  onWithdraw: (publication: Publication) => void
}) {
  const c = useCopy()
  const { locale } = useI18n()
  function dateLabel(value: string) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
  }
  return <ol className="publication-list" aria-label={c('固定版本记录', 'Fixed publication history')}>{publications.map((item) => <li key={item.id} className={item.state === 'withdrawn' ? 'publication-withdrawn' : undefined}>
    <div className="publication-version-title"><strong>{item.name}</strong><span>{item.state === 'withdrawn' ? c('已撤下', 'Withdrawn') : c('已发布', 'Published')}</span></div>
    <time dateTime={item.created_at}>{dateLabel(item.created_at)}</time>
    <p className="publication-version-detail">{c(`源修订 ${item.source_revision} · ${item.page_count} 页`, `Source revision ${item.source_revision} · ${item.page_count} pages`)}</p>
    {item.state === 'published' ? <div className="publication-version-actions"><button type="button" className="btn btn-sm" onClick={() => onCopy(item)}><Icon name="link" />{c('复制链接', 'Copy link')}</button><a className="btn btn-sm" href={item.url} target="_blank" rel="noopener noreferrer">{c('打开只读版本', 'Open read-only version')}<Icon name="arrow-right" /></a><button type="button" className="text-button publication-withdraw" disabled={busy} onClick={() => onWithdraw(item)}>{c('撤下', 'Withdraw')}</button></div>
      : <p className="publication-withdrawn-note">{c('原链接已失效，无法重新启用。', 'This link is unavailable and cannot be reactivated.')}</p>}
  </li>)}</ol>
}
