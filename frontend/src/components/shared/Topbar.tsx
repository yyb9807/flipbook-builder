import { Link } from 'react-router-dom'
import { useProjectStore } from '../../store/projectStore'
import { useSettingsStore } from '../../store/settingsStore'
import { ModeToggle } from './ModeToggle'
import { useConfirm } from './ConfirmDialog'
import { Icon } from './Icon'
import { LanguageSwitcher } from './LanguageSwitcher'
import { useI18n } from '../../i18n'

interface Props {
  /** 点 logo 时的回调（如父级想做埋点）。 */
  onLogoClick?: () => void
  /** 项目操作菜单（分享 / 导出）—— 由 BuilderPage 注入。 */
  projectActions?: React.ReactNode
}

export function Topbar({ onLogoClick, projectActions }: Props) {
  const project = useProjectStore((s) => s.project)
  const activeNodeId = useProjectStore((s) => s.activeNodeId)
  const navigationStack = useProjectStore((s) => s.navigationStack)
  const navigateTo = useProjectStore((s) => s.navigateTo)
  const resetProject = useProjectStore((s) => s.resetProject)
  const analyzing = useProjectStore((s) => s.analyzing)
  const generating = useProjectStore((s) => s.generating)
  const llmApiKey = useSettingsStore((s) => s.llmApiKey)
  const { confirm, ConfirmEl } = useConfirm()
  const { t } = useI18n()

  const breadcrumb = navigationStack.map((id) => ({
    id,
    title: project?.nodes[id]?.title || id,
  }))

  /** 返回主页：有项目时弹 confirm 再 reset。供「返回主页」按钮和 logo 共用。 */
  async function goHome(e?: React.MouseEvent) {
    if (analyzing || generating) {
      e?.preventDefault()
      return
    }
    if (!project) return // 无项目，让 Link 自然走 "/"
    e?.preventDefault()
    const ok = await confirm({
      title: t('topbar.confirmHomeTitle'),
      message: t('topbar.confirmHomeMessage'),
      confirmText: t('topbar.home'),
    })
    if (!ok) return
    resetProject()
    onLogoClick?.()
  }

  return (
    <div className="topbar">
      {/* Left: Logo + project name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Link to="/" onClick={goHome} className="topbar-logo">
          <span className="topbar-logo-mark">
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8">
              <path d="M4 4h7v16H4z" />
              <path d="M11 4h9v16h-9z" />
              <path d="M11 10h9" />
            </svg>
          </span>
          {t('common.appName')}
        </Link>
        {project && (
          <>
            <span className="topbar-sep">·</span>
            <span className="topbar-project-name">{project.name}</span>
          </>
        )}
      </div>

      {/* Center: breadcrumb */}
      {breadcrumb.length > 0 ? (
        <div className="crumb-nav">
          <div className="crumb-pill-row">
            {breadcrumb.map((item, i) => (
              <span key={item.id} style={{ display: 'flex', alignItems: 'center' }}>
                {i > 0 && <span className="crumb-item-sep">/</span>}
                <button
                  onClick={() => navigateTo(item.id)}
                  className={`crumb-item${item.id === activeNodeId ? ' cur' : ''}`}
                >
                  {item.id === navigationStack[0] ? '🏠 ' : ''}
                  {item.title.length > 10 ? item.title.slice(0, 10) + '…' : item.title}
                </button>
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="topbar-spacer" />
      )}

      {/* Right: project actions + new + settings + mode toggle */}
      <div className="topbar-right">
        {project && projectActions}
        {project && (
          <button onClick={() => goHome()} title={t('topbar.homeTooltip')} className="topbar-pill pink">
            <Icon name="arrow-left" size={12} stroke={2.4} />
            {t('topbar.home')}
          </button>
        )}
        <Link
          to="/settings"
          className={`topbar-pill${llmApiKey ? '' : ' warning'}`}
        >
          {!llmApiKey && '⚠ '}
          {llmApiKey ? t('topbar.settings') : t('topbar.settingsMissingKey')}
        </Link>
        <LanguageSwitcher />
        <ModeToggle />
      </div>
      {ConfirmEl}
    </div>
  )
}
