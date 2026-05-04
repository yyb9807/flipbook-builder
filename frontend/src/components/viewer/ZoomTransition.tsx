import { motion, AnimatePresence } from 'framer-motion'
import type { FlipNode, Hotspot } from '../../types'
import { ViewerHotspot } from './ViewerHotspot'

interface Props {
  node: FlipNode
  onHotspotClick: (hotspot: Hotspot) => void
  zoomOrigin: { x: number; y: number }
  direction: 'in' | 'out'
}

export function ZoomTransition({ node, onHotspotClick, zoomOrigin, direction }: Props) {
  const originStr = `${zoomOrigin.x * 100}% ${zoomOrigin.y * 100}%`

  const variants = {
    initial: {
      scale: direction === 'in' ? 0.15 : 1.5,
      opacity: 0,
    },
    animate: {
      scale: 1,
      opacity: 1,
      transition: { duration: 0.55, ease: [0.25, 0.46, 0.45, 0.94] },
    },
    exit: {
      scale: direction === 'in' ? 1.5 : 0.15,
      opacity: 0,
      transition: { duration: 0.4, ease: [0.55, 0.06, 0.68, 0.19] },
    },
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={node.id}
        variants={variants}
        initial="initial"
        animate="animate"
        exit="exit"
        style={{ transformOrigin: originStr, position: 'relative', width: '100%', height: '100%' }}
      >
        {node.image_url ? (
          <img
            src={node.image_url}
            alt={node.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            draggable={false}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              background: '#111',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'rgba(255,255,255,0.3)',
              fontSize: 14,
            }}
          >
            {node.title}
          </div>
        )}

        {/* Hotspot pins */}
        <div style={{ position: 'absolute', inset: 0 }}>
          {node.hotspots.map((hs, i) => (
            <ViewerHotspot key={hs.id} hotspot={hs} onClick={onHotspotClick} index={i} />
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
