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
        <div><h1>{c('你的创作工作台', 'Your creative workspace')}</h1>
          <p>{c('整理内容、补充来源，把知识连接成可以探索的作品。', 'Organize content, add sources and connect ideas into an explorable project.')}</p></div>
        <a className="text-button" href="#projects-title">{c('继续编辑作品', 'Continue a project')}<Icon name="arrow-right" /></a>
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
          <div className="example-caption"><div><h2 id="example-title">{c('一滴水的旅程', 'A water drop’s journey')}</h2><p>{c('4 页示例作品 · 无需配置', 'Four-page example · No setup needed')}</p></div></div>
          <div className="example-preview" aria-hidden="true">
            <SceneRenderer node={example.nodes[example.root_node_id!]} showHotspots={false} locale={locale} />
          </div>
          <p className="example-description">{c('看看正文、图片与分支如何协同。打开后可以复制到工作台，再按你的想法修改。', 'See text, images and branches work together. Open the example, then make a copy to edit.')}</p>
          <button className="text-button example-open" disabled={analyzing} onClick={openExample}>{c('体验示例', 'Explore example')}<Icon name="arrow-right" /></button>
        </section>
      </div>
      <ProjectList />
      <div className="workspace-principles"><span>{c('免账号', 'No account')}</span><span>{c('作品可编辑', 'Editable content')}</span><span>{c('离线也能阅读', 'Works offline')}</span></div>
    </main>
    <Footer />
    {ToastEl}
  </div>
}
