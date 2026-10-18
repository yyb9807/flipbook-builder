import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { Project } from '../types'
import { ProjectViewer } from '../components/scene/ProjectViewer'
import { useI18n } from '../i18n'

/** Read-only navigation owns its state and never replaces the author's workspace. */
export function SharedViewerPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [project, setProject] = useState<Project | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { locale } = useI18n()

  useEffect(() => {
    const controller = new AbortController()
    setProject(null)
    setError(null)
    if (!projectId) { setError(locale === 'zh' ? '缺少作品地址。' : 'The project address is missing.'); return }
    fetch(`/api/projects/${encodeURIComponent(projectId)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(locale === 'zh' ? '项目可能已被删除，或当前服务暂时无法连接。' : 'The project may have been removed, or the service is unavailable.')
        return response.json() as Promise<Project>
      })
      .then((value) => { if (!controller.signal.aborted) setProject(value) })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => controller.abort()
  }, [projectId, locale])

  if (error) return <div className="project-viewer viewer-empty"><div className="viewer-error"><h1>{locale === 'zh' ? '作品暂时无法打开' : 'This project could not be opened'}</h1><p>{error}</p><a href="/">{locale === 'zh' ? '返回工作区' : 'Back to workspace'}</a></div></div>
  if (!project) return <div className="project-viewer viewer-empty" aria-busy="true"><p role="status">{locale === 'zh' ? '正在打开作品…' : 'Opening project…'}</p><div className="viewer-loading" /></div>
  return <ProjectViewer project={project} locale={locale} />
}
