import { useRef, useState } from 'react'
import type { Hotspot } from '../../types'

interface Props {
  hotspots: Hotspot[]
  onUpdate: (hotspot: Hotspot) => void
  /** 已 linked 的热点点击时调用：进入对应子页。未传则只支持拖动，不响应点击。 */
  onNavigate?: (hotspot: Hotspot) => void
  containerWidth: number
  containerHeight: number
  readonly?: boolean
}

// 拖动判定阈值（像素）：pointerDown→Up 位移小于此值视为"点击"
const DRAG_THRESHOLD_PX = 5

export function HotspotOverlay({ hotspots, onUpdate, onNavigate, containerWidth, containerHeight, readonly }: Props) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  // 记录 pointer-down 起点，用于在 pointer-up 时区分"点击 vs 拖动"
  const downPosRef = useRef<{ x: number; y: number } | null>(null)
  const movedRef = useRef(false)

  // Pin center = position.x + size.width/2, position.y + size.height/2
  function pinCenter(hs: Hotspot) {
    return {
      x: hs.position.x + hs.size.width / 2,
      y: hs.position.y + hs.size.height / 2,
    }
  }

  function handlePointerDown(e: React.PointerEvent, hs: Hotspot) {
    if (readonly) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDraggingId(hs.id)
    downPosRef.current = { x: e.clientX, y: e.clientY }
    movedRef.current = false
  }

  function handlePointerMove(e: React.PointerEvent, hs: Hotspot) {
    if (draggingId !== hs.id || readonly || containerWidth === 0) return
    // 累计位移；若超过阈值标记为拖动，pointer-up 时不触发导航
    if (downPosRef.current) {
      const dx = e.clientX - downPosRef.current.x
      const dy = e.clientY - downPosRef.current.y
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) movedRef.current = true
    }
    // 没真正拖动前不更新位置，避免微抖把热点移走
    if (!movedRef.current) return
    const rect = overlayRef.current?.getBoundingClientRect()
    if (!rect) return
    const cx = (e.clientX - rect.left) / containerWidth
    const cy = (e.clientY - rect.top) / containerHeight
    const nx = Math.max(0, Math.min(1 - hs.size.width, cx - hs.size.width / 2))
    const ny = Math.max(0, Math.min(1 - hs.size.height, cy - hs.size.height / 2))
    onUpdate({ ...hs, position: { x: nx, y: ny } })
  }

  function handlePointerUp(hs: Hotspot) {
    setDraggingId(null)
    // 没拖动 + 已 linked → 视为点击，进入子页
    if (!movedRef.current && hs.target_node_id && onNavigate) {
      onNavigate(hs)
    }
    downPosRef.current = null
    movedRef.current = false
  }

  if (containerWidth === 0) return null

  return (
    <div ref={overlayRef} style={{ position: 'absolute', inset: 0 }}>
      {hotspots.map((hs, i) => {
        const { x, y } = pinCenter(hs)
        const isLinked = !!hs.target_node_id
        const isSelected = hs.selected
        const isDragging = draggingId === hs.id

        return (
          <div
            key={hs.id}
            className={`hotspot-pin${isLinked ? ' linked' : ''}${isSelected ? ' selected' : ''}${isDragging ? ' dragging' : ''}`}
            style={{
              left: `${x * 100}%`,
              top: `${y * 100}%`,
              // 已 linked 显示 pointer 暗示可点击进入；未 linked 是 grab（仅拖动）
              cursor: readonly ? 'pointer' : isLinked && onNavigate ? 'pointer' : 'grab',
              animation: isDragging ? 'none' : `bounceIn 0.5s ${0.05 + i * 0.08}s both`,
            }}
            onPointerDown={(e) => handlePointerDown(e, hs)}
            onPointerMove={(e) => handlePointerMove(e, hs)}
            onPointerUp={() => handlePointerUp(hs)}
          >
            <div className="hotspot-pin-visual">
              <div className="hotspot-pin-ring" />
              <div className="hotspot-pin-ring-2" />
              <div className="hotspot-pin-dot" />
              {isLinked && <div className="hotspot-pin-arrow">→</div>}
            </div>
            <div className="hotspot-pin-label">
              {hs.label}
              {hs.score !== undefined && !readonly && (
                <span style={{ marginLeft: 4, opacity: 0.6, fontFamily: 'var(--mono)' }}>
                  {Math.round(hs.score * 100)}%
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
