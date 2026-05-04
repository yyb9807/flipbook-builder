import { Link } from 'react-router-dom'
import { useI18n } from '../../i18n'

/**
 * 全局页脚：powered by + GitHub 链接 + 关于页入口。
 * 极简单行，挂在 HomePage / SettingsPage 等无需占满屏的页面底部。
 */
export function Footer() {
  const { t } = useI18n()
  return (
    <footer
      style={{
        padding: '14px 24px 18px',
        textAlign: 'center',
        fontSize: 12,
        color: 'var(--label-tertiary)',
        fontFamily: 'var(--sans)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
      }}
    >
      <span>
        {t('footer.poweredBy')}{' '}
        <a
          href="https://github.com/yyb9807"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: 'var(--label-secondary)',
            textDecoration: 'none',
            fontWeight: 500,
            transition: 'color 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--blue)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--label-secondary)')}
        >
          yuanbin@github
        </a>
      </span>
      <span style={{ color: 'var(--separator)' }}>·</span>
      <Link
        to="/about"
        style={{
          color: 'var(--label-secondary)',
          textDecoration: 'none',
          fontWeight: 500,
          transition: 'color 0.15s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--blue)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--label-secondary)')}
      >
        {t('footer.about')}
      </Link>
    </footer>
  )
}
