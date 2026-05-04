import type { Hotspot } from '../../types'
import { useI18n } from '../../i18n'

interface Props {
  hotspot: Hotspot
  onClick: (hotspot: Hotspot) => void
  index?: number
}

export function ViewerHotspot({ hotspot, onClick, index = 0 }: Props) {
  const { t } = useI18n()
  // 之前：无下钻就完全不渲染。改为：渲染为灰色不可点 pin，让用户知道这是终点。
  const linked = !!hotspot.target_node_id

  const cx = (hotspot.position.x + hotspot.size.width / 2) * 100
  const cy = (hotspot.position.y + hotspot.size.height / 2) * 100

  return (
    <div
      onClick={() => linked && onClick(hotspot)}
      title={linked ? hotspot.label : t('viewer.endpoint', { name: hotspot.label })}
      style={{
        position: 'absolute',
        left: `${cx}%`,
        top: `${cy}%`,
        transform: 'translate(-50%, -50%)',
        cursor: linked ? 'pointer' : 'default',
        zIndex: 10,
        animation: `bounceIn 0.5s ${0.2 + index * 0.1}s both`,
      }}
    >
      <div style={{ position: 'relative', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* Pulse rings — linked 才有动画 */}
        {linked && (
          <>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                border: '2px solid white',
                animation: 'pulseRing 2.4s ease-out infinite',
              }}
            />
            <div
              style={{
                position: 'absolute',
                inset: -6,
                borderRadius: '50%',
                border: '1.5px solid rgba(255,255,255,0.5)',
                animation: 'pulseRing 2.4s ease-out infinite 0.3s',
              }}
            />
          </>
        )}
        {/* Dot：linked 是粉色，无下钻是灰色 */}
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: linked ? 'var(--pink)' : 'var(--gray-3, #C7C7CC)',
            position: 'relative',
            zIndex: 2,
            boxShadow: linked
              ? '0 0 0 2px white, 0 2px 8px rgba(255,45,85,0.5)'
              : '0 0 0 1.5px rgba(255,255,255,0.4), 0 1px 3px rgba(0,0,0,0.25)',
            opacity: linked ? 1 : 0.7,
          }}
        />
        {/* Arrow badge — 仅 linked 显示 */}
        {linked && (
          <div
            style={{
              position: 'absolute',
              top: -3,
              right: -3,
              width: 14,
              height: 14,
              background: 'white',
              color: 'var(--pink)',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 9,
              fontWeight: 700,
              zIndex: 3,
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }}
          >
            →
          </div>
        )}
      </div>

      {/* Label */}
      <div
        className="hotspot-pin-label"
        style={{
          position: 'absolute',
          bottom: -32,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(255,255,255,0.92)',
          backdropFilter: 'saturate(180%) blur(20px)',
          WebkitBackdropFilter: 'saturate(180%) blur(20px)',
          borderRadius: 999,
          padding: '4px 10px',
          fontSize: 11.5,
          fontWeight: 600,
          whiteSpace: 'nowrap',
          color: linked ? 'var(--label)' : 'var(--label-secondary)',
          pointerEvents: 'none',
          opacity: 0,
        }}
      >
        {hotspot.label}
      </div>
    </div>
  )
}
