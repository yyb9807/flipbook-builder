import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api/client'
import { useProjectStore } from '../store/projectStore'
import { ViewerPage } from './ViewerPage'
import type { Project } from '../types'

/**
 * 分享链接专用入口：`/v/:projectId`。
 * - 从 API 加载项目（不依赖任何本地 store 状态）
 * - 自动切到 viewer 模式
 * - 加载完成后渲染 ViewerPage
 *
 * 该路由是只读的，没有"返回主页"等编辑入口。
 */
export function SharedViewerPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const setProject = useProjectStore((s) => s.setProject)
  const setActiveNode = useProjectStore((s) => s.setActiveNode)
  const navigateInto = useProjectStore((s) => s.navigateInto)
  const setMode = useProjectStore((s) => s.setMode)
  const resetProject = useProjectStore((s) => s.resetProject)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!projectId) return
    let alive = true
    // 进入分享视图时重置之前的状态，避免残留
    resetProject()
    setMode('viewer')
    api
      .getProject(projectId)
      .then((proj) => {
        if (!alive) return
        const p = proj as Project
        setProject(p)
        if (p.root_node_id) {
          setActiveNode(p.root_node_id)
          navigateInto(p.root_node_id)
        }
      })
      .catch((e) => alive && setError((e as Error).message || '加载失败'))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  if (loading) {
    return (
      <div
        style={{
          width: '100%',
          height: '100vh',
          background: 'black',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'rgba(255,255,255,0.5)',
          fontSize: 14,
        }}
      >
        加载中…
      </div>
    )
  }

  if (error) {
    return (
      <div
        style={{
          width: '100%',
          height: '100vh',
          background: 'black',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'rgba(255,255,255,0.7)',
          fontSize: 14,
          gap: 12,
          padding: 32,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 700 }}>翻翻书无法打开</div>
        <div>{error}</div>
        <div style={{ fontSize: 12, opacity: 0.5 }}>项目可能已被删除或链接无效。</div>
      </div>
    )
  }

  return <ViewerPage />
}
