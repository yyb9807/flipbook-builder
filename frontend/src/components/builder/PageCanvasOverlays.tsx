import type { FlipNode } from '../../types'
import { Icon } from '../shared/Icon'

/**
 * 画布上的小件 UI ——
 *   - <CanvasImage>: 图片本身 + 加载失败状态 + 等待状态
 *   - <PageTag>: 左上角 "L0 · 4 个热点" 胶囊
 *   - <BottomCard>: 底部标题/描述卡片 + 右下角重新生成按钮
 *
 * 把 PageCanvas 的 inline 子元素抽出来，让主组件只关心布局协调。
 */

interface CanvasImageProps {
  url: string | null
  title: string
  status: string
  onLoad: (aspect: number) => void
}

export function CanvasImage({ url, title, status, onLoad }: CanvasImageProps) {
  if (url) {
    return (
      <img
        src={url}
        alt={title}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        draggable={false}
        onLoad={(e) => {
          const img = e.currentTarget
          if (img.naturalWidth && img.naturalHeight) {
            onLoad(img.naturalWidth / img.naturalHeight)
          }
        }}
      />
    )
  }
  if (status === 'generated') {
    // 已"生成完成"但 image_url 为 null → 图片生成时失败了（中转抖动 / 超时等）
    return <ImageFailedHint />
  }
  return <ImagePendingHint title={title} />
}

function ImageFailedHint() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        padding: 24,
        background: 'rgba(255,149,0,0.08)',
      }}
    >
      <Icon name="warning" size={40} stroke={1.6} style={{ color: 'var(--orange)' }} />
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--orange)' }}>图片生成失败</div>
      <div
        style={{
          fontSize: 12.5,
          color: 'var(--label-secondary)',
          textAlign: 'center',
          maxWidth: 280,
          lineHeight: 1.5,
        }}
      >
        可能是中转网络抖动。点击右下角 <strong>↻ 重新生成</strong> 重试，
        <br />
        或换一个图片模型（如 flux-schnell）再试。
      </div>
    </div>
  )
}

function ImagePendingHint({ title }: { title: string }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--label-tertiary)',
        gap: 8,
      }}
    >
      <Icon name="image" size={40} stroke={1.5} />
      <span style={{ fontSize: 13 }}>{title || '等待生成图片'}</span>
    </div>
  )
}

// ─────────────── Top: page tag ───────────────

export function PageTag({ depth, hotspotCount }: { depth: number; hotspotCount: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 14,
        left: 14,
        right: 14,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        pointerEvents: 'none',
        zIndex: 5,
      }}
    >
      <div
        style={{
          background: 'rgba(255,255,255,0.88)',
          backdropFilter: 'saturate(180%) blur(20px)',
          WebkitBackdropFilter: 'saturate(180%) blur(20px)',
          borderRadius: 999,
          padding: '6px 12px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--label)',
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--pink)', flexShrink: 0 }} />
        L{depth} · {hotspotCount} 个热点
      </div>
    </div>
  )
}

// ─────────────── Bottom: title card + regenerate button ───────────────

interface BottomCardProps {
  node: FlipNode
  onRegenerate?: () => void
}

export function BottomCard({ node, onRegenerate }: BottomCardProps) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 14,
        left: 14,
        right: 14,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        pointerEvents: 'none',
        zIndex: 5,
        gap: 12,
      }}
    >
      <div
        style={{
          background: 'rgba(255,255,255,0.88)',
          backdropFilter: 'saturate(180%) blur(20px)',
          WebkitBackdropFilter: 'saturate(180%) blur(20px)',
          borderRadius: 16,
          padding: '12px 16px',
          maxWidth: '65%',
          pointerEvents: 'auto',
        }}
      >
        <h2
          style={{
            margin: 0,
            fontWeight: 700,
            fontSize: 20,
            lineHeight: 1.1,
            letterSpacing: '-0.025em',
            color: 'var(--label)',
          }}
        >
          {node.title}
        </h2>
        {node.description && (
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--label-secondary)', lineHeight: 1.4 }}>
            {node.description.length > 80 ? node.description.slice(0, 80) + '…' : node.description}
          </p>
        )}
      </div>

      {onRegenerate && node.depth > 0 && (
        <button
          onClick={onRegenerate}
          style={{
            pointerEvents: 'auto',
            width: 34,
            height: 34,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.88)',
            backdropFilter: 'saturate(180%) blur(20px)',
            WebkitBackdropFilter: 'saturate(180%) blur(20px)',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: 'var(--label)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            flexShrink: 0,
          }}
          title="重新生成此页"
        >
          <Icon name="refresh" size={14} />
        </button>
      )}
    </div>
  )
}
