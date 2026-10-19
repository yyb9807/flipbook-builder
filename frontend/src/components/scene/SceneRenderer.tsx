import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { FlipNode, Hotspot } from '../../types'
import { isImageHotspot } from '../../types'
import { hotspotCenter } from './geometry'
import { sectionHotspot } from './sectionHotspot'
import './scene.css'
import { citationAnchor, ContentAttribution, focusCitation } from './ContentAttribution'

export { sectionHotspot } from './sectionHotspot'

export interface SceneMetrics { width: number; height: number }

export interface SceneRendererProps {
  node: FlipNode
  selectedHotspotId?: string | null
  onHotspotActivate?: (hotspot: Hotspot) => void
  onHotspotSelect?: (hotspot: Hotspot) => void
  onHotspotOpen?: (hotspot: Hotspot) => void
  showHotspots?: boolean
  renderOverlay?: (metrics: SceneMetrics) => ReactNode
  className?: string
  locale?: 'zh' | 'en'
}

/** The same renderer powers the editor, read-only links and offline publications. */
export function SceneRenderer({
  node, selectedHotspotId, onHotspotActivate, onHotspotSelect, onHotspotOpen,
  showHotspots = true, renderOverlay, className = '', locale = 'zh',
}: SceneRendererProps) {
  const frame = useRef<HTMLDivElement>(null)
  const citationPrefix = useId()
  const [aspect, setAspect] = useState(1.6)
  const [metrics, setMetrics] = useState<SceneMetrics>({ width: 0, height: 0 })
  const document = node.scene_document
  const structured = document?.version === 1 && document.sections.length > 0

  useEffect(() => { setAspect(1.6) }, [node.image_url])
  useEffect(() => {
    const element = frame.current
    if (!element) return
    const update = () => setMetrics({ width: element.clientWidth, height: element.clientHeight })
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [node.id, structured])

  return (
    <div className={`scene-renderer ${className}`}>
      {structured ? (
        <div className={`scene-document scene-document--${document.layout}`}>
          {node.image_url && (
            <figure className="scene-document-illustration">
              <img src={node.image_url} alt={node.title} draggable={false} />
            </figure>
          )}
          <div className="scene-sections">
            {document.sections.map((section, index) => {
              const hotspot = sectionHotspot(node, section, index)
              const selected = hotspot.id === selectedHotspotId
              const linked = !!hotspot.target_node_id
              return (
                <article className={`scene-section${selected ? ' is-selected' : ''}`} key={section.id} id={citationAnchor(citationPrefix, 'section', section.id)} tabIndex={-1}>
                  {document.layout === 'sequence' && <span className="scene-section-step" aria-hidden="true">{index + 1}</span>}
                  <div className="scene-section-content">
                    <h3>
                      {onHotspotSelect ? (
                        <button type="button" className="scene-section-select" aria-pressed={selected} onClick={() => onHotspotSelect(hotspot)}>{section.title}</button>
                      ) : section.title}
                    </h3>
                    <p>{section.body}</p>
                    {!!section.reference_ids?.length && <nav className="section-citations" aria-label={locale === 'zh' ? `${section.title}的引用` : `Citations for ${section.title}`}>{section.reference_ids.map((id) => {
                      const index = node.content_metadata?.references.findIndex((reference) => reference.id === id) ?? -1
                      if (index < 0) return null
                      const reference = node.content_metadata!.references[index]
                      const target = citationAnchor(citationPrefix, 'reference', id)
                      return <a key={id} href={`#${target}`} aria-label={`${locale === 'zh' ? '查看参考资料' : 'Read reference'} ${index + 1}: ${reference.title}`} onClick={(event) => focusCitation(event, target)}>[{index + 1}]</a>
                    })}</nav>}
                    {linked && (onHotspotOpen || onHotspotActivate) && (
                      <button type="button" className="scene-section-link" onClick={() => (onHotspotOpen ?? onHotspotActivate)?.(hotspot)}>
                        {locale === 'zh' ? '打开页面' : 'Open page'}<ArrowIcon />
                      </button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="scene-image-stage">
          <div ref={frame} className="scene-image-box" style={{ aspectRatio: aspect, width: `min(100%, ${aspect * 66}vh)` }}>
            {node.image_url ? (
              <img className="scene-image" src={node.image_url} alt={node.title} draggable={false}
                onLoad={(event) => {
                  const image = event.currentTarget
                  if (image.naturalWidth && image.naturalHeight) setAspect(image.naturalWidth / image.naturalHeight)
                }} />
            ) : (
              <div className="scene-image-empty"><span>{node.title}</span><p>{locale === 'zh' ? onHotspotSelect ? '此页暂无插图，仍可编辑说明和分支。' : '此页暂无插图。' : onHotspotSelect ? 'No illustration yet. You can still edit the description and branches.' : 'This page has no illustration.'}</p></div>
            )}
            {showHotspots && node.hotspots.filter(isImageHotspot).map((hotspot, index) => {
              const center = hotspotCenter(hotspot)
              const linked = !!hotspot.target_node_id
              const selectable = !!onHotspotSelect
              return (
                <button type="button" key={hotspot.id}
                  className={`scene-hotspot${linked ? ' is-linked' : ''}${hotspot.id === selectedHotspotId ? ' is-selected' : ''}`}
                  style={{ left: `${center.x * 100}%`, top: `${center.y * 100}%` }}
                  aria-label={`${hotspot.label}${linked ? '' : locale === 'zh' ? '，尚未添加子页面' : ', no linked page'}`}
                  aria-pressed={selectable ? hotspot.id === selectedHotspotId : undefined}
                  disabled={!selectable && (!linked || !onHotspotActivate)}
                  title={hotspot.label}
                  onClick={() => selectable ? onHotspotSelect(hotspot) : onHotspotActivate?.(hotspot)}>
                  <span className="scene-hotspot-dot">{index + 1}</span><span className="scene-hotspot-label">{hotspot.label}</span>
                </button>
              )
            })}
            {renderOverlay?.(metrics)}
          </div>
        </div>
      )}
      <ContentAttribution metadata={node.content_metadata} sections={document?.sections} citationPrefix={citationPrefix} locale={locale} />
    </div>
  )
}

export function ArrowIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
}
