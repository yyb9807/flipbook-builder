import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useProjectStore } from '../store/projectStore'
import { useSettingsStore } from '../store/settingsStore'
import { useLibraryStore } from '../store/libraryStore'
import { Topbar } from '../components/shared/Topbar'
import { Icon } from '../components/shared/Icon'
import { ProjectActions } from '../components/builder/ProjectActions'
import { PageCanvas } from '../components/builder/PageCanvas'
import { HotspotPanel } from '../components/builder/HotspotPanel'
import { NodeContentEditor } from '../components/builder/NodeContentEditor'
import { TreeNav } from '../components/builder/TreeNav'
import { useToast } from '../components/shared/Toast'
import { useBuilderActions } from '../hooks/useBuilderActions'
import { useCopy } from '../i18n/workspace'
import { newId } from '../data/exampleProject'
import type { Hotspot } from '../types'
import { useNodeDraftStore } from '../store/nodeDraftStore'
import { currentProjectJob, projectGenerationLocked, useGenerationJobStore } from '../store/generationJobStore'
import { GenerationJobPanel } from '../components/builder/GenerationJobPanel'
import { sectionHotspot } from '../components/scene/sectionHotspot'
import { connectLocalBranch } from '../utils/localBranches'

type Tool = 'canvas' | 'pages' | 'hotspots' | 'content'
export function BuilderPage() {
  const c = useCopy()
  const [tool, setTool] = useState<Tool>('canvas')
  const [selected, setSelected] = useState<string | null>(null)
  const [branchImages, setBranchImages] = useState(false)
  const project = useProjectStore((s) => s.project)
  const activeNodeId = useProjectStore((s) => s.activeNodeId)
  const origin = useProjectStore((s) => s.origin)
  const generating = useProjectStore((s) => s.generating)
  const jobLocked = useGenerationJobStore((s) => projectGenerationLocked(s, project?.project_id, origin))
  const currentJob = useGenerationJobStore((s) => project ? currentProjectJob(s, project.project_id) : null)
  const editingLocked = generating || jobLocked
  const navigate = useProjectStore((s) => s.navigateTo)
  const setProject = useProjectStore((s) => s.setProject)
  const llmKey = useSettingsStore((s) => s.llmApiKey)
  const imageKey = useSettingsStore((s) => s.imgGenApiKey)
  const storageError = useLibraryStore((s) => s.storageError)
  const hasDrafts = useNodeDraftStore((s) => Object.keys(s.drafts[project?.project_id ?? ''] ?? {}).length > 0)
  const { show, ToastEl } = useToast()
  const actions = useBuilderActions(show)
  if (!project || !activeNodeId || !project.nodes[activeNodeId]) return null
  const node = project.nodes[activeNodeId]
  const missing = node.hotspots.filter((h) => h.selected && !h.target_node_id)
  const contentHotspots = node.scene_document ? node.scene_document.sections.map((section, index) => sectionHotspot(node, section, index)) : node.hotspots
  const selectedHotspot = contentHotspots.find((hotspot) => hotspot.id === selected)
  const activeSelection = selectedHotspot?.id ?? null
  function select(h: Hotspot) { setSelected(h.id); if (node.scene_document) setTool('content') }
  function open(h: Hotspot) { if (h.target_node_id) { navigate(h.target_node_id); setSelected(null); setTool('canvas') } }
  function createBranch(h: Hotspot) {
    const current = useProjectStore.getState()
    const currentProject = current.project
    if (!currentProject || current.origin !== 'local' || currentProject.project_id !== project?.project_id) return
    if (Object.keys(useNodeDraftStore.getState().drafts[currentProject.project_id] ?? {}).length) {
      show(c('请先保存页面草稿，再添加子页。', 'Save page drafts before adding a page.'), 'info')
      return
    }
    const connected = connectLocalBranch(currentProject, node.id, h.id, newId(), newId(), c('进一步解释', 'Explain further'))
    if (!connected) return
    setProject(connected.project, 'local')
    navigate(connected.nodeId)
    setSelected(null)
    setTool('content')
  }
  const saveLabel = actions.saveStatus === 'saving' ? c('保存中…', 'Saving…') : actions.saveStatus === 'error' ? c('保存失败，已留本地副本', 'Save failed · local copy kept') : hasDrafts ? c('有页面草稿待保存', 'Page drafts need saving') : origin === 'local' ? c('已保存在此浏览器', 'Saved in this browser') : c('已保存', 'Saved')
  const saveClass = 'save-status ' + actions.saveStatus + (hasDrafts ? ' draft' : '')
  const needsAttention = origin === 'server' && (currentJob?.status === 'partial' || currentJob?.status === 'failed' || Boolean(currentJob?.result?.warnings?.length))
  const branchLabel = node.scene_document ? c('分支', 'Branches') : c('热点', 'Hotspots')
  const tools: [Tool, string][] = [['canvas', c('画布', 'Canvas')], ['pages', c('页面', 'Pages')], ['hotspots', branchLabel], ['content', c('内容', 'Content')]]
  return <div className="editor-shell">
    <Topbar projectActions={<ProjectActions />} />
    <main className={'editor-grid tool-' + tool} id="main-content">
      <aside className="editor-outline"><TreeNav /></aside>
      <section className="editor-main">
        <div className="editor-page-heading"><div><nav className="editor-breadcrumb" aria-label={c('页面路径', 'Page path')}>{node.parent_id && <button className="text-button" onClick={() => navigate(node.parent_id!)}><Icon name="arrow-left" />{c('上级页面', 'Parent page')}</button>}<span>{c('第 ', 'Level ') + (node.depth + 1) + c(' 层', '')}</span></nav><h1>{node.title}</h1></div>
          <span className={saveClass} role="status">{saveLabel}</span>
        </div>
        {storageError && <div className="notice notice-error" role="alert">{c('浏览器存储空间不足，修改仅保留在当前页面。请立即导出作品。', 'Browser storage is full. Changes are only in this tab. Export your project now.')}</div>}
        {actions.saveStatus === 'error' && <div className="notice notice-error"><span>{editingLocked ? c('恢复副本已保留。请等待生成任务与页面同步完成后再重试保存。', 'A recovery copy is kept. Wait for generation and page sync before retrying.') : c('工作台中已保留恢复副本。请重试保存，或导出当前作品。', 'A recovery copy is available in the workspace. Retry saving or export this project.')}</span><button className="btn btn-sm" disabled={editingLocked} onClick={() => void actions.retryPending()}>{c('重试保存', 'Retry saving')}</button></div>}
        {(jobLocked || needsAttention) && <div className="generation-mobile-status" role="status"><span>{jobLocked ? c('生成任务正在核对或处理，页面编辑暂不可用。', 'A generation job is being checked or processed. Editing is paused.') : currentJob?.status === 'failed' ? c('上次生成未完成，原有内容已保留。', 'The last generation did not finish. Existing content is kept.') : c('页面已保存，仍有生成提示待查看。', 'The page is saved with generation warnings.')}</span><button className="text-button" onClick={() => setTool('hotspots')}>{jobLocked ? c('查看生成任务', 'View generation job') : c('查看生成提示', 'View warnings')}</button></div>}
        <PageCanvas disabled={editingLocked} node={node} selectedHotspotId={activeSelection} onHotspotSelect={select} onHotspotUpdate={(h) => { void actions.handleHotspotUpdate(h) }} onHotspotNavigate={open} onRegenerate={origin === 'server' && !editingLocked && !hasDrafts && !node.hotspots.length && !node.scene_document ? () => { void actions.handleRegenerate() } : undefined} />
        {node.description && <p className="editor-page-description">{node.description}</p>}
        {node.children.length > 0 && <section className="branch-strip"><h2>{c('继续探索', 'Continue exploring')}</h2><div>{node.children.map((id) => project.nodes[id] && <button className="branch-link" key={id} onClick={() => { navigate(id); setTool('canvas') }}><span>{project.nodes[id].title}</span><Icon name="arrow-right" /></button>)}</div></section>}
      </section>
      <aside className="editor-inspector">
        <div className="inspector-page-context" aria-label={c('当前编辑页面', 'Current page')}><strong>{node.title}</strong><span className={saveClass} role="status">{saveLabel}</span></div>
        <div className="inspector-tabs"><button aria-pressed={tool !== 'content'} onClick={() => setTool('hotspots')}>{branchLabel}</button><button aria-pressed={tool === 'content'} onClick={() => setTool('content')}>{c('内容', 'Content')}</button></div>
        <fieldset disabled={editingLocked} className="inspector-body">{tool === 'content' ? <NodeContentEditor key={project.project_id + node.id} projectId={project.project_id} node={node} selectedHotspotId={activeSelection} local={origin === 'local'} onSave={(patch) => actions.handleNodeUpdate(node.id, patch)} selectionAction={selectedHotspot && (selectedHotspot.target_node_id ? <button type="button" className="text-button" onClick={() => open(selectedHotspot)}>{c('打开分支', 'Open branch')}<Icon name="arrow-right" /></button> : origin === 'local' ? <button type="button" className="text-button" disabled={editingLocked || hasDrafts} onClick={() => createBranch(selectedHotspot)}><Icon name="plus" />{c('添加子页', 'Add page')}</button> : undefined)} /> :
          <HotspotPanel node={node} local={origin === 'local'} canCreateBranch={!hasDrafts} selectedId={activeSelection} onSelect={select} onOpen={open} onEditContent={() => setTool('content')} onCreateBranch={origin === 'local' ? createBranch : undefined} onAdd={!node.scene_document ? () => { void actions.handleAddHotspot() } : undefined} onHotspotChange={(h) => { void actions.handleHotspotUpdate(h) }} />}</fieldset>
        <div className="generation-section">
          {origin === 'server' && <GenerationJobPanel key={project.project_id} projectId={project.project_id} />}
          {jobLocked ? null : origin === 'local' ? <p>{hasDrafts ? c('先保存页面草稿，再添加子页或预览作品。', 'Save page drafts before adding pages or previewing.') : c('修改保存在此浏览器，完成后请导出备份。', 'Changes are kept in this browser. Export a backup when ready.')}</p> :
              !node.hotspots.length ? <p>{node.image_url ? c('添加热点后，即可为图片连接新的分支。', 'Add a hotspot to connect a new branch from this image.') : c('添加一个分支起点，再选择要生成的页面。', 'Add a starting point, then select the pages to generate.')}</p> :
              node.hotspots.every((hotspot) => hotspot.target_node_id) ? <p>{c('此页分支已全部连接，可打开分支检查内容。', 'All branches on this page are connected. Open one to review it.')}</p> :
              !llmKey ? <><p>{c('生成知识分支需要配置内容模型；插图可选。', 'Set up a text model to generate knowledge pages. Illustrations are optional.')}</p><Link className="btn btn-primary" to="/settings"><Icon name="gear" />{c('配置 AI 服务', 'Set up AI')}</Link></> :
                <><label className="creation-image-option"><input type="checkbox" checked={branchImages} onChange={(event) => setBranchImages(event.target.checked)} />{c('为新分支生成插图（可选）', 'Illustrate new pages (optional)')}</label>{branchImages && !imageKey ? <><p>{c('生成插图还需图片服务，也可取消勾选只生成知识正文。', 'Illustrations require an image provider. Uncheck to generate knowledge content only.')}</p><Link className="btn btn-primary" to="/settings">{c('配置图片服务', 'Set up image provider')}</Link></> : <><p>{hasDrafts ? c('请先保存页面草稿，再生成新分支。', 'Save page drafts before generating new branches.') : c('仅生成选中的未连接要点，已有页面会保留。', 'Generate selected, unconnected ideas. Existing pages are kept.')}</p><button className="btn btn-primary" disabled={!missing.length || actions.saveStatus !== 'saved' || hasDrafts} onClick={() => void actions.handleGenerateChildren(branchImages)}><Icon name="spark" />{missing.length ? c('生成 ' + missing.length + ' 个分支', 'Generate ' + missing.length + ' branches') : c('先选择待生成要点', 'Select ideas to generate')}</button></>}</>}
        </div>
      </aside>
    </main>
    <nav className="mobile-editor-tools" aria-label={c('编辑工具', 'Editor tools')}>{tools.map(([id, label]) => <button key={id} aria-pressed={tool === id} onClick={() => setTool(id)}>{label}</button>)}</nav>
    {ToastEl}
  </div>
}
