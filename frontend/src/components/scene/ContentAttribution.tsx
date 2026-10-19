import { useId } from 'react'
import type { MouseEvent } from 'react'
import type { ContentMetadata, SceneSection } from '../../types'
import { safeReferenceUrl } from '../../utils/sourceUrl'

export function ContentProvenance({ metadata, locale = 'zh' }: { metadata?: ContentMetadata | null; locale?: 'zh' | 'en' }) {
  const provenance = metadata?.provenance
  const zh = locale === 'zh'
  const inputLabel = provenance?.input_kind === 'image' ? (zh ? '图片输入' : 'image input')
    : provenance?.input_kind === 'parent_page' ? (zh ? '上级页面' : 'parent page')
      : provenance?.input_kind === 'page' ? (zh ? '已有页面上下文' : 'existing page context') : (zh ? '主题文字' : 'topic text')
  return <p className="content-provenance">{provenance
    ? <>{zh ? 'AI 辅助生成' : 'AI-assisted content'} · {inputLabel} · {zh ? '模型：' : 'Model: '}{provenance.model}</>
    : zh ? '未记录生成方式。' : 'The creation method was not recorded.'}</p>
}

/** The same attribution is rendered online, in preview, and in offline publications. */
export function citationAnchor(prefix: string, kind: 'section' | 'reference', id: string) {
  return `${prefix}-${kind}-${encodeURIComponent(id)}`
}

export function focusCitation(event: MouseEvent<HTMLAnchorElement>, id: string) {
  const target = event.currentTarget.ownerDocument.getElementById(id)
  if (!target) return
  event.preventDefault()
  target.scrollIntoView?.({ block: 'start' })
  target.focus({ preventScroll: true })
}

export function ContentAttribution({ metadata, locale = 'zh', sections = [], citationPrefix }: { metadata?: ContentMetadata | null; locale?: 'zh' | 'en'; sections?: SceneSection[]; citationPrefix?: string }) {
  const fallbackPrefix = useId()
  const prefix = citationPrefix ?? fallbackPrefix
  const zh = locale === 'zh'
  const references = metadata?.references ?? []
  const review = metadata && <p className="content-review-status">{metadata.review_status === 'reviewed'
    ? zh ? '作者声明已人工核对。' : 'The author states that they reviewed this page.'
    : zh ? '尚未人工核对。' : 'Not yet reviewed by the author.'}</p>
  if (!references.length) return <details className="content-attribution content-attribution--empty">
    <summary>{zh ? '来源与生成说明' : 'Sources and creation notes'}{metadata && <span>{metadata.review_status === 'reviewed' ? zh ? '作者已核对' : 'Author reviewed' : zh ? '待核对' : 'Not reviewed'}</span>}</summary>
    <ContentProvenance metadata={metadata} locale={locale} />
    {review}
    <p className="content-reference-empty">{zh ? '本页未附参考资料。' : 'No reference materials are attached to this page.'}</p>
  </details>
  return <section className="content-attribution" aria-label={zh ? '参考资料与生成说明' : 'References and creation notes'}>
    <div className="content-attribution-heading"><h3>{zh ? '参考资料' : 'References'} <span>{references.length}</span></h3>{review}</div>
    <p className="content-reference-notice">{references.some((reference) => reference.excerpt !== undefined)
      ? zh ? '以下为作者保存并关联的资料副本。检索、摘录和引用关联均不代表事实已核验。' : 'These are source copies saved and linked by the author. Search, excerpts and citation links do not establish factual accuracy.'
      : zh ? '参考资料由作者填写，系统未抓取或核验，也不表示已逐条支持正文。' : 'References are supplied by the author. The system has not fetched or verified them, or checked that they support each statement.'}</p>
    <ol className="content-reference-list">{references.map((reference, index) => {
      const href = reference.url ? safeReferenceUrl(reference.url) : null
      const licenseHref = reference.license_url ? safeReferenceUrl(reference.license_url) : null
      const linkedSections = sections.filter((section) => section.reference_ids?.includes(reference.id))
      return <li key={reference.id} id={citationAnchor(prefix, 'reference', reference.id)} tabIndex={-1}>
        <span className="reference-number" aria-hidden="true">[{index + 1}]</span>
        <div className="reference-copy">
        {href ? <a className="reference-title" href={href} target="_blank" rel="noopener noreferrer">{reference.title}</a> : <span className="reference-title">{reference.title}</span>}
        {reference.locator && <p>{reference.locator}</p>}
        {reference.note && <p>{reference.note}</p>}
        {reference.excerpt !== undefined && <details className="reference-excerpt"><summary>{zh ? '查看保存摘录' : 'Read saved excerpt'}</summary><blockquote>{reference.excerpt || (zh ? '没有保存摘录正文。' : 'No excerpt text was saved.')}</blockquote></details>}
        {(reference.source_revision || reference.retrieved_at) && <p className="reference-version">{reference.source_revision && <span>{zh ? '来源版本 ' : 'Source revision '}{reference.source_revision}</span>}{reference.retrieved_at && <span>{zh ? '保存于 ' : 'Saved '}{reference.retrieved_at.slice(0, 10)}</span>}</p>}
        {reference.license_title && <p className="reference-license">{zh ? '来源许可：' : 'Source license: '}{licenseHref ? <a href={licenseHref} target="_blank" rel="noopener noreferrer">{reference.license_title}</a> : reference.license_title}</p>}
        {linkedSections.length > 0 && <div className="reference-backlinks" aria-label={zh ? '关联区块' : 'Linked sections'}>{linkedSections.map((section) => {
          const target = citationAnchor(prefix, 'section', section.id)
          return <a key={section.id} href={`#${target}`} onClick={(event) => focusCitation(event, target)}>{zh ? '返回「' : 'Back to “'}{section.title}{zh ? '」' : '”'}</a>
        })}</div>}
        </div>
      </li>
    })}</ol>
    <details className="content-creation-details"><summary>{zh ? '生成说明' : 'Creation notes'}</summary><ContentProvenance metadata={metadata} locale={locale} /></details>
  </section>
}
