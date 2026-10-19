import { Link } from 'react-router-dom'
import { Icon } from '../shared/Icon'
import { LanguageSwitcher } from '../shared/LanguageSwitcher'
import { useI18n } from '../../i18n'
import { useCopy } from '../../i18n/workspace'

export function SettingsNav() {
  const { t } = useI18n()
  const c = useCopy()
  return (
    <nav className="settings-nav" aria-label={t('settings.navTitle')}>
      <Link to="/" className="topbar-logo" aria-label={c('返回创作', 'Back to creating')}><span className="topbar-logo-mark"><Icon name="json" size={19} /></span><span>Flipbook <strong>Builder</strong></span></Link>
      <Link to="/" className="settings-back-link"><Icon name="arrow-left" size={16} />{t('common.back')}</Link>
      <span className="settings-nav-title">{c('AI 服务', 'AI services')}</span>
      <LanguageSwitcher />
    </nav>
  )
}
