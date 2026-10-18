import { createRoot } from 'react-dom/client'
import { ProjectViewer } from './components/scene/ProjectViewer'
import type { Project } from './types'

const root = document.getElementById('flipbook-player')
const data = document.getElementById('flipbook-data')
if (root && data) {
  try {
    const project = JSON.parse(data.textContent ?? '') as Project
    createRoot(root).render(<ProjectViewer project={project} />)
  } catch {
    root.textContent = '作品数据无法读取。请重新导出作品。 / This project could not be opened. Please export it again.'
  }
}
