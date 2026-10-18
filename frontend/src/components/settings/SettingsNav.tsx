import { Link } from 'react-router-dom'
import { Icon } from '../shared/Icon'
import { LanguageSwitcher } from '../shared/LanguageSwitcher'
import { useI18n } from '../../i18n'

export function SettingsNav() {
  const { t } = useI18n()
  return (
    <nav className="settings-nav" aria-label={t('settings.navTitle')}>
      <Link to="/"><Icon name="arrow-left" size={16} />{t('common.back')}</Link>
      <span>{t('settings.navTitle')}</span>
      <LanguageSwitcher />
    </nav>
  )
}
