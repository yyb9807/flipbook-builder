import type { ImageHotspot } from '../../types'

export function hotspotCenter(hotspot: ImageHotspot) {
  return {
    x: hotspot.position.x + hotspot.size.width / 2,
    y: hotspot.position.y + hotspot.size.height / 2,
  }
}

/** Positions use image coordinates, including when the image is letterboxed. */
export function moveHotspot(hotspot: ImageHotspot, x: number, y: number): ImageHotspot {
  const width = Math.max(0, Math.min(1, hotspot.size.width))
  const height = Math.max(0, Math.min(1, hotspot.size.height))
  return {
    ...hotspot,
    position: {
      x: Math.max(0, Math.min(1 - width, x)),
      y: Math.max(0, Math.min(1 - height, y)),
    },
    size: { width, height },
  }
}
