import { useProjectStore } from '../../store/projectStore'
import { useCopy } from '../../i18n/workspace'
import { Icon } from '../shared/Icon'
import { useNodeDraftStore } from '../../store/nodeDraftStore'

export function TreeNav() {
  const project = useProjectStore((s) => s.project)
  const active = useProjectStore((s) => s.activeNodeId)
  const navigate = useProjectStore((s) => s.navigateTo)
  const c = useCopy()
  const drafts = useNodeDraftStore((s) => s.drafts[project?.project_id ?? ''])
  if (!project) return null
  function renderNode(id: string, visited = new Set<string>()): React.ReactNode {
    if (!project) return null
    const node = project.nodes[id]
    if (!node || visited.has(id)) return null
    const next = new Set(visited).add(id)
    return <li key={id}><button className={active === id ? 'tree-page active' : 'tree-page'} aria-current={active === id ? 'page' : undefined} onClick={() => navigate(id)}>
      <Icon name="json" size={15} /><span>{node.title || c('未命名页面', 'Untitled page')}</span>{drafts?.[id] && <span className="tree-draft">{c('草稿', 'Draft')}</span>}<span className="tree-page-depth">{node.depth + 1}</span>
    </button>{node.children.length > 0 && <ul>{node.children.map((child) => renderNode(child, next))}</ul>}</li>
  }
  return <nav className="page-tree" aria-label={c('作品页面', 'Project pages')}>
    <div className="panel-heading"><h2>{c('作品页面', 'Pages')}</h2><span>{Object.keys(project.nodes).length}</span></div>
    <ul className="tree-root">{project.root_node_id && renderNode(project.root_node_id)}</ul>
    <p className="panel-footnote">{c('通过热点连接页面，让读者沿着想法探索。', 'Connect pages with hotspots so readers can follow an idea.')}</p>
  </nav>
}
