import { useState } from 'react'
import type { FlipNode, Hotspot } from '../../types'
import { ZoomTransition } from './ZoomTransition'

interface Props {
  node: FlipNode
  onHotspotClick: (hotspot: Hotspot) => void
}

export function ViewerCanvas({ node, onHotspotClick }: Props) {
  const [zoomOrigin, setZoomOrigin] = useState({ x: 0.5, y: 0.5 })
  const [direction] = useState<'in' | 'out'>('in')

  function handleHotspotClick(hs: Hotspot) {
    setZoomOrigin({
      x: hs.position.x + hs.size.width / 2,
      y: hs.position.y + hs.size.height / 2,
    })
    onHotspotClick(hs)
  }

  return (
    <ZoomTransition
      node={node}
      onHotspotClick={handleHotspotClick}
      zoomOrigin={zoomOrigin}
      direction={direction}
    />
  )
}
