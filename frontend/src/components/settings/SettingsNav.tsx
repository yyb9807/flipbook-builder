import { Link } from 'react-router-dom'
import { Icon } from '../shared/Icon'
import { LanguageSwitcher } from '../shared/LanguageSwitcher'
import { useI18n } from '../../i18n'

/** 设置页顶栏：返回链接 + 标题 + 语言切换。 */
export function SettingsNav() {
  const { t } = useI18n()
  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.78)',
        backdropFilter: 'saturate(180%) blur(20px)',
        WebkitBackdropFilter: 'saturate(180%) blur(20px)',
        borderBottom: '0.5px solid var(--separator)',
        padding: '12px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}
    >
      <Link
        to="/"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 14,
          color: 'var(--blue)',
          textDecoration: 'none',
          fontWeight: 400,
        }}
      >
        <Icon name="arrow-left" size={14} />
        {t('common.back')}
      </Link>
      <span style={{ color: 'var(--label-tertiary)', fontSize: 13 }}>·</span>
      <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-0.01em' }}>
        {t('settings.navTitle')}
      </span>
      <div style={{ flex: 1 }} />
      <LanguageSwitcher />
    </div>
  )
}
