import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import type { FlipNode, Hotspot, ImageHotspot } from '../../types'
import { isImageHotspot } from '../../types'
import { SceneRenderer } from './SceneRenderer'
import { hotspotCenter, moveHotspot } from './geometry'

interface Props {
  node: FlipNode
  onHotspotCommit: (hotspot: Hotspot) => void
  onHotspotSelect?: (hotspot: Hotspot) => void
  selectedHotspotId?: string | null
  onHotspotOpen?: (hotspot: Hotspot) => void
  locale?: 'zh' | 'en'
}

/** Drag changes stay local until pointer-up. Selection never opens a child page. */
export function SceneEditor({ node, onHotspotCommit, onHotspotSelect, selectedHotspotId, onHotspotOpen, locale = 'zh' }: Props) {
  const [draft, setDraft] = useState<ImageHotspot | null>(null)
  const draftRef = useRef<ImageHotspot | null>(null)
  const interaction = useRef<{ hotspot: ImageHotspot; x: number; y: number; moved: boolean } | null>(null)
  const keyboard = useRef(false)

  useEffect(() => { setDraft(null); draftRef.current = null; interaction.current = null }, [node.id, node.hotspots])

  function preview(hotspot: ImageHotspot) { draftRef.current = hotspot; setDraft(hotspot) }
  function clear() { draftRef.current = null; setDraft(null); interaction.current = null; keyboard.current = false }
  function commit() {
    const result = draftRef.current
    clear()
    if (result) onHotspotCommit(result)
  }
  function pointerDown(event: PointerEvent<HTMLButtonElement>, hotspot: ImageHotspot) {
    if (event.button !== 0) return
    onHotspotSelect?.(hotspot)
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    interaction.current = { hotspot, x: event.clientX, y: event.clientY, moved: false }
  }
  function pointerMove(event: PointerEvent<HTMLButtonElement>, hotspot: ImageHotspot) {
    const current = interaction.current
    if (!current || current.hotspot.id !== hotspot.id) return
    const dx = event.clientX - current.x
    const dy = event.clientY - current.y
    if (Math.hypot(dx, dy) <= 5 && !current.moved) return
    current.moved = true
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect()
    if (!bounds?.width || !bounds.height) return
    preview(moveHotspot(current.hotspot, current.hotspot.position.x + dx / bounds.width, current.hotspot.position.y + dy / bounds.height))
  }
  function pointerUp() {
    if (interaction.current?.moved) commit()
    else clear()
  }
  function keyDown(event: KeyboardEvent<HTMLButtonElement>, hotspot: ImageHotspot) {
    if (event.key === 'Escape') { event.preventDefault(); clear(); return }
    const movement: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const delta = movement[event.key]
    if (!delta) return
    event.preventDefault()
    keyboard.current = true
    const current = draftRef.current?.id === hotspot.id ? draftRef.current : hotspot
    const increment = event.shiftKey ? 0.02 : 0.005
    preview(moveHotspot(current, current.position.x + delta[0] * increment, current.position.y + delta[1] * increment))
  }
  const previewNode = draft ? { ...node, hotspots: node.hotspots.map((hotspot) => hotspot.id === draft.id ? draft : hotspot) } : node

  return (
    <SceneRenderer node={previewNode} selectedHotspotId={selectedHotspotId} onHotspotSelect={onHotspotSelect} onHotspotOpen={onHotspotOpen}
      showHotspots={false} locale={locale}
      renderOverlay={() => (
        <div className="scene-editor-overlay">
          {previewNode.hotspots.filter(isImageHotspot).map((hotspot, index) => {
            const center = hotspotCenter(hotspot)
            return <button type="button" key={hotspot.id}
              className={`scene-hotspot scene-hotspot--editable${hotspot.id === selectedHotspotId ? ' is-selected' : ''}${interaction.current?.hotspot.id === hotspot.id ? ' is-dragging' : ''}`}
              style={{ left: `${center.x * 100}%`, top: `${center.y * 100}%` }}
              aria-label={locale === 'zh' ? `选择热点：${hotspot.label}；使用方向键移动` : `Select hotspot: ${hotspot.label}; use arrow keys to move`}
              aria-pressed={hotspot.id === selectedHotspotId}
              onClick={() => onHotspotSelect?.(hotspot)}
              onPointerDown={(event) => pointerDown(event, hotspot)} onPointerMove={(event) => pointerMove(event, hotspot)}
              onPointerUp={pointerUp} onPointerCancel={clear} onLostPointerCapture={() => { if (interaction.current) clear() }}
              onKeyDown={(event) => keyDown(event, hotspot)}
              onKeyUp={(event) => { if (event.key.startsWith('Arrow') && keyboard.current) commit() }}
              onBlur={() => { if (keyboard.current) commit() }}>
              <span className="scene-hotspot-dot">{index + 1}</span><span className="scene-hotspot-label">{hotspot.label}</span>
            </button>
          })}
        </div>
      )} />
  )
}
