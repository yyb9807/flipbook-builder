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
import { useI18n } from '../../i18n'

export function ProjectList() {
  const c = useCopy()
  const { locale } = useI18n()
  const [items, setItems] = useState<ProjectListItem[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [opening, setOpening] = useState<string | null>(null)
  const [showPublications, setShowPublications] = useState(false)
  const [query, setQuery] = useState('')
  const [location, setLocation] = useState<'all' | 'local' | 'server'>('all')
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
      if (isLocal) {
        if (!remove(id)) throw new Error(c('浏览器未能保存删除操作，作品和草稿已保留。请检查存储空间，或重新载入作品库后重试。', 'The browser could not save this deletion. The project and its drafts are kept. Check storage or reload the library, then retry.'))
      }
      else { await api.deleteProject(id); setItems((s) => s.filter((p) => p.project_id !== id)) }
      useNodeDraftStore.getState().removeProject(id)
    } catch (e) { show(c('删除失败：', 'Could not delete: ') + (e as Error).message, 'error') }
  }
  const locals = Object.values(local)
  function updatedTimestamp(value: string) {
    const timestamp = Date.parse(value)
    return Number.isFinite(timestamp) ? timestamp : 0
  }
  function dateLabel(value: string) {
    return Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en', { dateStyle: 'medium' }).format(new Date(value)) : c('更新时间未知', 'Update time unavailable')
  }
  const all = [
    ...locals.map(({ project, updatedAt }) => ({ id: project.project_id, name: project.name, count: Object.keys(project.nodes).length, image: project.nodes[project.root_node_id ?? '']?.image_url, local: true, updated: updatedAt, project })),
    ...items.map((p) => ({ id: p.project_id, name: p.name, count: p.node_count, image: p.thumbnail, local: false, updated: p.updated_at ?? p.created_at ?? '', project: null })),
  ].sort((a, b) => updatedTimestamp(b.updated) - updatedTimestamp(a.updated) || a.name.localeCompare(b.name, locale))
  const normalizedQuery = query.trim().toLocaleLowerCase(locale)
  const filtered = all.filter((project) => (!normalizedQuery || project.name.toLocaleLowerCase(locale).includes(normalizedQuery)) && (location === 'all' || project.local === (location === 'local')))
  const filtering = Boolean(normalizedQuery) || location !== 'all'
  function resetFilters() { setQuery(''); setLocation('all') }
  return <section className="projects-section" aria-labelledby="projects-title">
    <div className="section-heading projects-heading"><div><h2 id="projects-title" tabIndex={-1}>{c('继续编辑', 'Continue editing')}</h2><p>{c('最近更新的作品排在前面。', 'Your most recently updated projects appear first.')}</p></div><button type="button" className="text-button publication-library-trigger" ref={publicationTrigger} onClick={() => setShowPublications(true)}><Icon name="share" />{c('发布记录', 'Published versions')}</button></div>
    {(all.length > 0 || filtering) && <div className="library-toolbar">
      <label className="library-search"><Icon name="search" size={17} /><span className="visually-hidden">{c('查找作品', 'Find a project')}</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={c('按作品名称搜索', 'Search project names')} /></label>
      <label className="library-filter"><span>{c('存储位置', 'Storage')}</span><select value={location} onChange={(event) => setLocation(event.target.value as typeof location)}><option value="all">{c('全部作品', 'All projects')}</option><option value="local">{c('此浏览器', 'This browser')}</option><option value="server">{c('此服务器', 'This server')}</option></select></label>
      <p className="library-results-count" role="status">{filtering ? c(`${filtered.length} / ${all.length} 份作品`, `${filtered.length} of ${all.length} projects`) : c(`${all.length} 份作品`, `${all.length} projects`)}</p>
    </div>}
    {status === 'loading' && <div className="library-status" role="status">{c('正在连接作品库…', 'Connecting to your library…')}</div>}
    {status === 'error' && <div className="library-status"><span>{c('尚未连接后端。你仍可编辑本地作品和体验示例。', 'The backend is unavailable. Local projects and examples still work.')}</span><button className="text-button" onClick={() => { setStatus('loading'); setAttempt((n) => n + 1) }}>{c('重新连接', 'Reconnect')}</button></div>}
    {all.length === 0 && status !== 'loading' && !filtering ? <div className="empty-projects"><Icon name="json" size={28} /><strong>{c('还没有作品', 'No projects yet')}</strong><span>{c('从上方主题或图片开始，也可以先体验示例。', 'Start with a topic or image above, or explore the example.')}</span></div> : filtering && filtered.length === 0 ? <div className="empty-projects"><Icon name="search" size={24} /><strong>{c('没有找到匹配的作品', 'No matching projects')}</strong><span>{c('换一个名称，或查看其他存储位置。', 'Try another name or storage location.')}</span><button type="button" className="text-button" onClick={resetFilters}>{c('清除筛选', 'Clear filters')}</button></div> : <div className="projects-grid">{filtered.map((p) => <article className="project-card" key={`${p.local ? 'local' : 'server'}:${p.id}`}>
      <button className="project-open" disabled={opening !== null || busy} onClick={() => p.project ? open(p.project, 'local') : void openServer(p.id)}>
        <div className="project-card-thumb">{p.image ? <img src={p.image} alt="" loading="lazy" /> : <div className="project-typographic-cover"><span>{p.name.slice(0, 1)}</span><div className="cover-lines" aria-hidden="true"><i /><i /><i /></div></div>}</div>
        <div className="project-card-meta"><h3 title={p.name}>{p.name}</h3><p><span>{p.count} {c('页', p.count === 1 ? 'page' : 'pages')}</span><span>·</span><span>{p.local ? c('此浏览器', 'This browser') : c('此服务器', 'This server')}</span>{Object.keys(drafts[p.id] ?? {}).length > 0 && <span className="project-draft-status">{c('含草稿', 'Has drafts')}</span>}</p><time dateTime={Number.isFinite(Date.parse(p.updated)) ? p.updated : undefined}>{dateLabel(p.updated)}</time></div>
      </button>
      <button className="project-card-delete" disabled={busy} aria-label={c('删除 ', 'Delete ') + p.name} onClick={() => void deleteEntry(p.id, p.name, p.local)}><Icon name="trash" size={15} /></button>
    </article>)}</div>}
    {showPublications && <PublicationLibrary onClose={() => { setShowPublications(false); publicationTrigger.current?.focus() }} />}
    {ToastEl}{ConfirmEl}
  </section>
}
