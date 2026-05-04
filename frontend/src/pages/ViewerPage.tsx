import { useState } from 'react'
import { useProjectStore } from '../store/projectStore'
import { ViewerHotspot } from '../components/viewer/ViewerHotspot'
import { ViewerTopBar } from '../components/viewer/ViewerTopBar'
import { ViewerBottomContent } from '../components/viewer/ViewerBottomContent'
import type { Hotspot } from '../types'

const ZOOM_MS = 500
const BACK_MS = 300

/**
 * 浏览模式（沉浸式）。点击热点 → zoom in 进入子页 → navigateInto；点 ← 返回 → zoom out。
 * 子件：
 *   - <ViewerHotspot> 单个热点 pin（粉色 / 灰色）
 *   - <ViewerTopBar> 顶栏（返回 / 状态 / 退出）
 *   - <ViewerBottomContent> 底部面包屑 + 标题 + 描述
 */
export function ViewerPage() {
  const project = useProjectStore((s) => s.project)
  const activeNodeId = useProjectStore((s) => s.activeNodeId)
  const navigateInto = useProjectStore((s) => s.navigateInto)
  const navigateBack = useProjectStore((s) => s.navigateBack)
  const setMode = useProjectStore((s) => s.setMode)
  const [zooming, setZooming] = useState(false)

  if (!project || !activeNodeId) return <EmptyView />

  const node = project.nodes[activeNodeId]
  if (!node) return null

  const path = buildPath(project.nodes, activeNodeId)

  function handleHotspotClick(hs: Hotspot) {
    if (!hs.target_node_id) return
    setZooming(true)
    setTimeout(() => {
      navigateInto(hs.target_node_id!)
      setZooming(false)
    }, ZOOM_MS)
  }

  function handleBack() {
    setZooming(true)
    setTimeout(() => {
      navigateBack()
      setZooming(false)
    }, BACK_MS)
  }

  return (
    <div
      className="animate-fade-in"
      style={{ position: 'fixed', inset: 0, background: 'black', overflow: 'hidden' }}
    >
      {/* Full-screen image with zoom transform */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transition: 'transform 0.5s cubic-bezier(0.65,0,0.35,1)',
          transform: zooming ? 'scale(2.4)' : 'scale(1)',
        }}
      >
        {node.image_url ? (
          <img
            src={node.image_url}
            alt={node.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', background: '#1a1a2e' }} />
        )}
      </div>

      {/* Gradient overlay for readability */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 40%),' +
            'linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, transparent 28%)',
          pointerEvents: 'none',
        }}
      />

      {/* Hotspot pins */}
      {node.hotspots.map((hs, i) => (
        <ViewerHotspot key={hs.id} hotspot={hs} onClick={handleHotspotClick} index={i} />
      ))}

      <ViewerTopBar
        showBack={!!node.parent_id}
        onBack={handleBack}
        onExit={() => setMode('builder')}
      />

      <ViewerBottomContent node={node} path={path} />
    </div>
  )
}

function EmptyView() {
  return (
    <div
      style={{
        width: '100%',
        height: '100vh',
        background: 'black',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'rgba(255,255,255,0.4)',
        fontSize: 14,
      }}
    >
      没有可浏览的内容
    </div>
  )
}

/** 从根向当前节点构建祖先路径（不含 root 的根 — 用 nodes map 反向追 parent_id）。 */
function buildPath(
  nodes: Record<string, { parent_id: string | null; title: string }>,
  fromId: string,
): { id: string; title: string }[] {
  const out: { id: string; title: string }[] = []
  let cur: string | null = fromId
  while (cur) {
    const n = nodes[cur]
    if (!n) break
    out.unshift({ id: cur, title: n.title })
    cur = n.parent_id
  }
  return out
}
