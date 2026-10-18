import { useEffect, useRef, useState } from 'react'
import type { Project } from '../../types'
import { SceneRenderer, ArrowIcon, sectionHotspot } from './SceneRenderer'

interface Props {
  project: Project
  activeNodeId?: string | null
  onNavigate?: (nodeId: string) => void
  onExit?: () => void
  exitLabel?: string
  onCreateCopy?: () => void
  locale?: 'zh' | 'en'
}

export function ProjectViewer({ project, activeNodeId, onNavigate, onExit, exitLabel, onCreateCopy, locale: localeProp }: Props) {
  const [localId, setLocalId] = useState(project.root_node_id)
  const heading = useRef<HTMLHeadingElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const locale = localeProp ?? (project.settings.language?.startsWith('en') ? 'en' : 'zh')
  const node = project.nodes[activeNodeId ?? localId ?? project.root_node_id ?? '']
    ?? project.nodes[project.root_node_id ?? '']
  const path: { id: string; title: string }[] = []
  const seen = new Set<string>()
  let current = node
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift({ id: current.id, title: current.title })
    current = project.nodes[current.parent_id ?? '']
  }

  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
    if (container.current) container.current.scrollTop = 0
  }, [node?.id])

  function navigate(nodeId: string) {
    if (!project.nodes[nodeId]) return
    setLocalId(nodeId)
    onNavigate?.(nodeId)
  }

  if (!node) return <div className="project-viewer viewer-empty"><h1>{locale === 'zh' ? '这份作品还没有页面' : 'This project has no pages yet'}</h1>{onExit && <button type="button" onClick={onExit}>{exitLabel ?? (locale === 'zh' ? '返回编辑' : 'Back to editor')}</button>}</div>

  const sections = node.scene_document?.sections
  const navigationHotspots = sections?.length
    ? sections.map((section, index) => sectionHotspot(node, section, index))
    : node.hotspots
  const linked = navigationHotspots.filter((hotspot) => hotspot.target_node_id && project.nodes[hotspot.target_node_id])
  return (
    <div ref={container} className="project-viewer" lang={locale === 'zh' ? 'zh-CN' : 'en'}>
      <header className="viewer-header">
        <span className="viewer-project-name">{project.name}</span>
        <span className="viewer-page-count">{locale === 'zh' ? `${Object.keys(project.nodes).length} 页作品` : `${Object.keys(project.nodes).length} pages`}</span>
        {onCreateCopy && <button type="button" className="viewer-exit viewer-copy" onClick={onCreateCopy}>{locale === 'zh' ? '创建我的副本' : 'Make a copy'}</button>}
        {onExit && <button type="button" className="viewer-exit" onClick={onExit}>{exitLabel ?? (locale === 'zh' ? '返回编辑' : 'Back to editor')}</button>}
      </header>
      <main className="viewer-main">
        <nav className="viewer-breadcrumb" aria-label={locale === 'zh' ? '页面路径' : 'Page path'}>
          {path.map((part, index) => <span key={part.id}>
            {index > 0 && <span className="viewer-breadcrumb-separator" aria-hidden="true">/</span>}
            <button type="button" onClick={() => navigate(part.id)} aria-current={part.id === node.id ? 'page' : undefined}>{part.title}</button>
          </span>)}
        </nav>
        <div className="viewer-heading">
          <h1 ref={heading} tabIndex={-1}>{node.title}</h1>
          {node.parent_id && <button type="button" className="viewer-back" onClick={() => navigate(node.parent_id!)}><ArrowIcon />{locale === 'zh' ? '上一层' : 'Parent page'}</button>}
        </div>
        {node.description && <p className="viewer-description">{node.description}</p>}
        <div className="viewer-scene"><SceneRenderer key={node.id} node={node} locale={locale} onHotspotActivate={(hotspot) => hotspot.target_node_id && navigate(hotspot.target_node_id)} /></div>
        {linked.length > 0 && (
          <section className="viewer-explore" aria-label={locale === 'zh' ? '继续探索' : 'Explore pages'}>
            <h2>{locale === 'zh' ? '继续探索' : 'Keep exploring'}</h2>
            <div>{linked.map((hotspot) => <button type="button" key={hotspot.id} onClick={() => navigate(hotspot.target_node_id!)}>{hotspot.label}<ArrowIcon /></button>)}</div>
          </section>
        )}
        {linked.length === 0 && <p className="viewer-end-note">{locale === 'zh' ? '你已来到这一分支的最后一页。' : 'You have reached the end of this branch.'}</p>}
      </main>
      <footer className="viewer-footer">Flipbook Builder<span>{locale === 'zh' ? '交互式视觉作品' : 'Interactive visual stories'}</span></footer>
    </div>
  )
}
