import { useProjectStore } from '../store/projectStore'
import { useI18n } from '../i18n'
import { ProjectViewer } from '../components/scene/ProjectViewer'
import { newId } from '../data/exampleProject'

export function ViewerPage() {
  const project = useProjectStore((state) => state.project)
  const activeNodeId = useProjectStore((state) => state.activeNodeId)
  const navigateTo = useProjectStore((state) => state.navigateTo)
  const setMode = useProjectStore((state) => state.setMode)
  const origin = useProjectStore((state) => state.origin)
  const openProject = useProjectStore((state) => state.openProject)
  const resetProject = useProjectStore((state) => state.resetProject)
  const { locale } = useI18n()

  if (!project) return <div className="project-viewer viewer-empty"><p>{locale === 'zh' ? '没有可浏览的作品' : 'There is no project to preview'}</p><button type="button" onClick={() => setMode('builder')}>{locale === 'zh' ? '返回工作区' : 'Back to workspace'}</button></div>
  function copyExample() {
    const copy = structuredClone(project!)
    copy.project_id = 'local-' + newId()
    copy.name = (copy.nodes[copy.root_node_id ?? '']?.title || copy.name) + (locale === 'zh' ? ' · 我的副本' : ' · My copy')
    openProject(copy, 'local', 'builder')
  }
  return <ProjectViewer project={project} activeNodeId={activeNodeId} onNavigate={navigateTo} onExit={origin === 'example' ? resetProject : () => setMode('builder')} exitLabel={origin === 'example' ? (locale === 'zh' ? '返回工作台' : 'Workspace') : undefined} onCreateCopy={origin === 'example' ? copyExample : undefined} locale={locale} />
}
