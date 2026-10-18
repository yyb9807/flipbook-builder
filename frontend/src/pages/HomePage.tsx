import { useMemo } from 'react'
import { Topbar } from '../components/shared/Topbar'
import { Footer } from '../components/shared/Footer'
import { UploadZone } from '../components/home/UploadZone'
import { ProjectList } from '../components/home/ProjectList'
import { SceneRenderer } from '../components/scene/SceneRenderer'
import { useProjectStore } from '../store/projectStore'
import { useBuilderActions } from '../hooks/useBuilderActions'
import { useToast } from '../components/shared/Toast'
import { createExampleProject } from '../data/exampleProject'
import { useI18n } from '../i18n'
import { useCopy } from '../i18n/workspace'
import { Icon } from '../components/shared/Icon'

export function HomePage() {
  const c = useCopy()
  const { locale } = useI18n()
  const example = useMemo(() => createExampleProject(locale), [locale])
  const analyzing = useProjectStore((s) => s.analyzing)
  const openProject = useProjectStore((s) => s.openProject)
  const { show, ToastEl } = useToast()
  const { handleUpload } = useBuilderActions(show)
  const openExample = () => openProject(example, 'example', 'viewer')

  return <div className="workspace-shell">
    <Topbar />
    <main className="workspace-home" id="main-content">
      <header className="workspace-intro">
        <h1>{c('让知识，变得可以探索。', 'Make knowledge explorable.')}</h1>
        <p>{c('从一个主题或一幅图开始，把解释与分支连接起来。', 'Start with a topic or an image. Connect ideas, explanations and new paths.')}</p>
      </header>
      <div className="workspace-start">
        <section className="creation-surface" aria-label={c('开始创作', 'Start creating')}>
          <UploadZone onFile={(file, keywords) => { void handleUpload(file, undefined, keywords, false) }} onText={(text, generateImages) => { void handleUpload(undefined, text, undefined, generateImages) }} loading={analyzing} />
          {analyzing && <div className="inline-progress" role="status">
            <strong>{c('正在准备任务提交…', 'Preparing your submission…')}</strong>
            <p>{c('接收成功后，可在作品任务页查询进度和恢复。', 'Once accepted, progress and recovery are available on the project task page.')}</p>
          </div>}
        </section>
        <section className="example-surface" aria-labelledby="example-title">
          <div className="example-heading"><span className="status-tag">{c('可交互示例', 'Interactive example')}</span><span>{c('无需 API Key', 'No API key needed')}</span></div>
          <div className="example-preview" aria-hidden="true">
            <SceneRenderer node={example.nodes[example.root_node_id!]} showHotspots={false} locale={locale} />
          </div>
          <div className="example-caption"><div><h2 id="example-title">{c('一滴水的旅程', 'A water drop’s journey')}</h2><p>{c('4 页知识作品，试着点开一条分支。', 'A four-page project. Follow a branch and see how it works.')}</p></div>
            <button className="btn btn-primary" disabled={analyzing} onClick={openExample}>{c('体验示例', 'Explore example')}<Icon name="arrow-right" /></button>
          </div>
        </section>
      </div>
      <ProjectList />
      <div className="workspace-principles"><span>{c('免账号', 'No account')}</span><span>{c('作品可编辑', 'Editable content')}</span><span>{c('离线也能阅读', 'Works offline')}</span></div>
    </main>
    <Footer />
    {ToastEl}
  </div>
}
