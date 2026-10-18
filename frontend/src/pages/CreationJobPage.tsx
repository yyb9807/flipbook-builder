import { Topbar } from '../components/shared/Topbar'
import { GenerationJobPanel } from '../components/builder/GenerationJobPanel'
import { useProjectStore } from '../store/projectStore'
import { useCopy } from '../i18n/workspace'

/** A server project exists before its first page: reloads must still expose its job. */
export function CreationJobPage() {
  const project = useProjectStore((state) => state.project)
  const reset = useProjectStore((state) => state.resetProject)
  const c = useCopy()
  if (!project) return null
  return <div className="workspace-shell">
    <Topbar />
    <main className="creation-job-page" id="main-content">
      <header><span className="status-tag">{c('作品创建', 'Project creation')}</span><h1>{project.name}</h1>
        <p>{c('第一张页面完成后会自动进入编辑器。任务由服务器保存，刷新、离开或进入设置都不会取消。', 'The editor opens when the first page is ready. The server keeps your job when you reload, leave or open settings.')}</p></header>
      <GenerationJobPanel key={project.project_id} projectId={project.project_id} emptyRoot />
      <div className="creation-job-return"><p>{c('尚未生成页面？可以返回工作台调整输入并创建新作品。原主题与关键词仍会保留；正在运行的任务会继续。', 'No page yet? Return to the workspace to adjust your input and create a new project. Your topic and keywords are kept; any running job continues.')}</p>
        <button className="btn" onClick={reset}>{c('返回创作输入', 'Return to your input')}</button></div>
    </main>
  </div>
}
