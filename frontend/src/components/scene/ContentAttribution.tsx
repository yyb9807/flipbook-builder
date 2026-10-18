import type { ContentMetadata } from '../../types'
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
export function ContentAttribution({ metadata, locale = 'zh' }: { metadata?: ContentMetadata | null; locale?: 'zh' | 'en' }) {
  const zh = locale === 'zh'
  const references = metadata?.references ?? []
  return <section className="content-attribution" aria-label={zh ? '参考资料与生成说明' : 'References and creation notes'}>
    <h3>{zh ? '参考资料与生成说明' : 'References and creation notes'}</h3>
    <ContentProvenance metadata={metadata} locale={locale} />
    {metadata && <p className="content-review-status">{metadata.review_status === 'reviewed'
      ? zh ? '作者声明已人工核对。' : 'The author states that they reviewed this page.'
      : zh ? '尚未人工核对。' : 'Not yet reviewed by the author.'}</p>}
    {references.length ? <ol className="content-reference-list">{references.map((reference) => {
      const href = reference.url ? safeReferenceUrl(reference.url) : null
      return <li key={reference.id}>
        {href ? <a href={href} target="_blank" rel="noopener noreferrer">{reference.title}</a> : <span>{reference.title}</span>}
        {reference.note && <p>{reference.note}</p>}
      </li>
    })}</ol> : <p className="content-reference-empty">{zh ? '本页未附参考资料。' : 'No reference materials are attached to this page.'}</p>}
    <p className="content-reference-notice">{zh ? '参考资料由作者填写，系统未抓取或核验，也不表示已逐条支持正文。' : 'References are supplied by the author. The system has not fetched or verified them, or checked that they support each statement.'}</p>
  </section>
}
