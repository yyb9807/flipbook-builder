import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import { useProjectStore } from '../../store/projectStore'
import { useLibraryStore } from '../../store/libraryStore'
import { useToast } from '../shared/Toast'
import { useConfirm } from '../shared/ConfirmDialog'
import { Icon } from '../shared/Icon'
import { useCopy } from '../../i18n/workspace'
import type { Project } from '../../types'
import type { ProjectListItem } from '../../types/api'
import { useNodeDraftStore } from '../../store/nodeDraftStore'
import { PublicationLibrary } from './PublicationLibrary'

export function ProjectList() {
  const c = useCopy()
  const [items, setItems] = useState<ProjectListItem[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [opening, setOpening] = useState<string | null>(null)
  const [showPublications, setShowPublications] = useState(false)
  const publicationTrigger = useRef<HTMLButtonElement>(null)
  const local = useLibraryStore((s) => s.projects)
  const drafts = useNodeDraftStore((s) => s.drafts)
  const remove = useLibraryStore((s) => s.remove)
  const open = useProjectStore((s) => s.openProject)
  const busy = useProjectStore((s) => s.analyzing || s.generating)
  const { show, ToastEl } = useToast()
  const { confirm, ConfirmEl } = useConfirm()
  useEffect(() => {
    let alive = true
    api.listProjects().then((r) => { if (alive) { setItems(r.projects); setStatus('ready') } }).catch(() => { if (alive) setStatus('error') })
    return () => { alive = false }
  }, [attempt])
  async function openServer(id: string) {
    setOpening(id)
    try { open(await api.getProject(id) as Project, 'server') } catch (e) { show(c('打开失败：', 'Could not open: ') + (e as Error).message, 'error') } finally { setOpening(null) }
  }
  async function deleteEntry(id: string, name: string, isLocal: boolean) {
    if (!await confirm({ title: c('删除作品？', 'Delete project?'), message: c('“', '“') + name + c('”及其页面将被删除。此操作无法撤销。', '” and its pages will be deleted. This cannot be undone.') + (isLocal ? '' : c('已发布的固定版本会保留，可从发布记录单独撤下。', ' Published fixed versions remain available and can be withdrawn from Published versions.')), confirmText: c('删除作品', 'Delete project'), tone: 'danger' })) return
    try {
      if (isLocal) remove(id)
      else { await api.deleteProject(id); setItems((s) => s.filter((p) => p.project_id !== id)) }
      useNodeDraftStore.getState().removeProject(id)
    } catch (e) { show(c('删除失败：', 'Could not delete: ') + (e as Error).message, 'error') }
  }
  const locals = Object.values(local).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const all = [
    ...locals.map(({ project, updatedAt }) => ({ id: project.project_id, name: project.name, count: Object.keys(project.nodes).length, image: project.nodes[project.root_node_id ?? '']?.image_url, local: true, updated: updatedAt, project })),
    ...items.map((p) => ({ id: p.project_id, name: p.name, count: p.node_count, image: p.thumbnail, local: false, updated: p.updated_at ?? '', project: null })),
  ]
  return <section className="projects-section" aria-labelledby="projects-title">
    <div className="section-heading projects-heading"><h2 id="projects-title">{c('我的作品', 'Your projects')}</h2><span className="muted">{all.length ? c(all.length + ' 份作品', all.length + ' projects') : c('从第一个想法开始', 'Start with your first idea')}</span><button type="button" className="text-button publication-library-trigger" ref={publicationTrigger} onClick={() => setShowPublications(true)}><Icon name="share" />{c('发布记录', 'Published versions')}</button></div>
    {status === 'loading' && <div className="library-status" role="status">{c('正在连接作品库…', 'Connecting to your library…')}</div>}
    {status === 'error' && <div className="library-status"><span>{c('尚未连接后端。你仍可编辑本地作品和体验示例。', 'The backend is unavailable. Local projects and examples still work.')}</span><button className="text-button" onClick={() => { setStatus('loading'); setAttempt((n) => n + 1) }}>{c('重新连接', 'Reconnect')}</button></div>}
    {all.length === 0 && status !== 'loading' ? <div className="empty-projects"><Icon name="json" size={28} /><strong>{c('你的下一份作品，从这里开始', 'Your next project starts here')}</strong><span>{c('创建一个主题，或先打开上方示例。', 'Create a topic or explore the example above.')}</span></div> : <div className="projects-grid">{all.map((p) => <article className="project-card" key={p.id}>
      <button className="project-open" disabled={opening !== null || busy} onClick={() => p.project ? open(p.project, 'local') : void openServer(p.id)}>
        <div className="project-card-thumb">{p.image ? <img src={p.image} alt="" loading="lazy" /> : <div className="project-typographic-cover"><span>{p.name.slice(0, 1)}</span><div className="cover-lines" aria-hidden="true"><i /><i /><i /></div></div>}</div>
        <div className="project-card-meta"><h3>{p.name}</h3><p>{p.count} {c('页', 'pages')}<span>·</span>{Object.keys(drafts[p.id] ?? {}).length ? c('含草稿', 'Has drafts') : p.local ? c('此浏览器', 'This browser') : c('此实例', 'This instance')}</p></div>
      </button>
      <button className="project-card-delete" disabled={busy} aria-label={c('删除 ', 'Delete ') + p.name} onClick={() => void deleteEntry(p.id, p.name, p.local)}><Icon name="trash" size={15} /></button>
    </article>)}</div>}
    {showPublications && <PublicationLibrary onClose={() => { setShowPublications(false); publicationTrigger.current?.focus() }} />}
    {ToastEl}{ConfirmEl}
  </section>
}
