import { Link } from 'react-router-dom'
import { useProjectStore } from '../../store/projectStore'
import { ModeToggle } from './ModeToggle'
import { Icon } from './Icon'
import { LanguageSwitcher } from './LanguageSwitcher'
import { useCopy } from '../../i18n/workspace'
import type { ReactNode } from 'react'

export function Topbar({ projectActions, onLogoClick }: { projectActions?: ReactNode; onLogoClick?: () => void }) {
  const project = useProjectStore((s) => s.project)
  const reset = useProjectStore((s) => s.resetProject)
  const busy = useProjectStore((s) => s.analyzing || s.generating)
  const c = useCopy()
  function home(event: React.MouseEvent) {
    if (busy) { event.preventDefault(); return }
    reset()
    onLogoClick?.()
  }
  return <header className="topbar">
    <Link to="/" onClick={home} className="topbar-logo" aria-label={c('Flipbook Builder 工作台', 'Flipbook Builder workspace')}>
      <span className="topbar-logo-mark"><Icon name="json" size={19} /></span>
      <span>Flipbook <strong>Builder</strong></span>
    </Link>
    {project && <span className="topbar-project-name" title={project.name}>{project.name}</span>}
    <div className="topbar-spacer" />
    <nav className="topbar-right" aria-label={c('主导航', 'Main navigation')}>
      {project && <Link to="/" onClick={home} className="topbar-pill" aria-disabled={busy}><Icon name="arrow-left" />{c('工作台', 'Workspace')}</Link>}
      {projectActions}
      <Link to="/settings" className="topbar-pill" aria-label={c('AI 服务设置', 'AI service settings')} aria-disabled={busy} onClick={(e) => { if (busy) e.preventDefault() }}><Icon name="gear" /><span className="settings-link-label">{c('AI 服务', 'AI services')}</span></Link>
      <LanguageSwitcher />
      <ModeToggle />
    </nav>
  </header>
}
