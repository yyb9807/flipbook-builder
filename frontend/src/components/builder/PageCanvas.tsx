import { useRef, useEffect, useState } from 'react'
import type { FlipNode, Hotspot } from '../../types'
import { HotspotOverlay } from './HotspotOverlay'
import { CanvasImage, PageTag, BottomCard } from './PageCanvasOverlays'
import { useI18n } from '../../i18n'

interface Props {
  node: FlipNode
  onHotspotUpdate: (hotspot: Hotspot) => void
  /** 点击已 linked 的热点时回调（进入子页） */
  onHotspotNavigate?: (hotspot: Hotspot) => void
  onRegenerate?: () => void
}

/**
 * 主画布：图片 + 热点 + 顶部标签 + 底部标题卡 + 重新生成按钮 + 拖动提示。
 * 各小件抽到 PageCanvasOverlays.tsx，本组件只协调布局和状态（尺寸 / 入场动画 / 图片宽高比）。
 */
export function PageCanvas({ node, onHotspotUpdate, onHotspotNavigate, onRegenerate }: Props) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ width: 0, height: 0 })
  const [entering, setEntering] = useState(true)
  // 实际图片的宽高比；动态匹配让画布尺寸与图等比，避免 object-fit:cover 裁剪。
  // 同时保证热点坐标（image-relative 0-1）天然对齐画布。
  const [imgAspect, setImgAspect] = useState<number | null>(null)

  useEffect(() => {
    setEntering(true)
    const t = setTimeout(() => setEntering(false), 500)
    return () => clearTimeout(t)
  }, [node.id])

  // image_url 变化时重置 aspect，避免上一张图的比例残留
  useEffect(() => {
    setImgAspect(null)
  }, [node.image_url])

  useEffect(() => {
    if (!frameRef.current) return
    const ro = new ResizeObserver(() => {
      if (frameRef.current) {
        setDims({
          width: frameRef.current.offsetWidth,
          height: frameRef.current.offsetHeight,
        })
      }
    })
    ro.observe(frameRef.current)
    return () => ro.disconnect()
  }, [])

  // 默认 16/10 等待图片加载（兼容 16:9 flux 和 1:1 dall-e-3 的折中）
  const aspectRatio = imgAspect ? `${imgAspect}` : '16 / 10'

  return (
    <div
      style={{
        position: 'relative',
        background: 'var(--bg-elev)',
        borderRadius: 16,
        overflow: 'hidden',
        boxShadow: 'var(--shadow-card)',
        // 自然高度（不再 flex:1 撑满父列），让父列在内容溢出时滚动
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      className="canvas-dot-grid"
    >
      {/* Wrapper: relative, no overflow clip — allows pin labels to overflow.
          aspectRatio 动态匹配图片真实比例，避免裁剪；max-height 防止过高图片撑爆视口。 */}
      <div
        className={`canvas-enter${entering ? ' entering' : ''}`}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 960,
          aspectRatio,
          maxHeight: '70vh',
          margin: '0 auto',
        }}
      >
        {/* Canvas frame — overflow:hidden 在这一层（图片要圆角裁剪），
            标签/重生成按钮在外层 wrapper 里，能溢出而不被裁切 */}
        <div
          ref={frameRef}
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 18,
            overflow: 'hidden',
            boxShadow: '0 8px 32px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.04)',
            background: 'var(--gray-5)',
          }}
        >
          <CanvasImage
            url={node.image_url}
            title={node.title}
            status={node.status}
            onLoad={setImgAspect}
          />

          <PageTag depth={node.depth} hotspotCount={node.hotspots.length} />
          <BottomCard node={node} onRegenerate={onRegenerate} />
        </div>

        {/* Hotspot overlay — OUTSIDE overflow:hidden frame so labels can extend freely.
            pointerEvents:'none' 让 wrapper 不拦截点击，单个热点元素自己有 pointerEvents:'auto'。
            否则会盖住下方的「重新生成」按钮和标题卡。 */}
        {dims.width > 0 && (
          <div style={{ position: 'absolute', inset: 0, borderRadius: 18, zIndex: 10, pointerEvents: 'none' }}>
            <HotspotOverlay
              hotspots={node.hotspots}
              onUpdate={onHotspotUpdate}
              onNavigate={onHotspotNavigate}
              containerWidth={dims.width}
              containerHeight={dims.height}
            />
          </div>
        )}
      </div>

      {/* Drag hint */}
      {node.hotspots.length > 0 && <DragHint />}
    </div>
  )
}

function DragHint() {
  const { t } = useI18n()
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 14,
        left: '50%',
        transform: 'translateX(-50%)',
        fontFamily: 'var(--mono)',
        fontSize: 11,
        color: 'var(--label-tertiary)',
        background: 'var(--bg-elev)',
        border: '1px solid var(--separator)',
        borderRadius: 99,
        padding: '4px 12px',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
      }}
    >
      {t('builder.canvas.dragHint')}
    </div>
  )
}
