import { useI18n } from '../../i18n'
import type { Locale } from '../../i18n'

interface Props {
  /** 紧凑模式（topbar 用）：只显示一个简短按钮，点击切换 */
  compact?: boolean
}

const LABELS: Record<Locale, { short: string; long: string }> = {
  zh: { short: '中', long: '中文' },
  en: { short: 'EN', long: 'English' },
}

/**
 * 中英语言切换器。
 * compact=true：单按钮显示当前语言简写，点击切换到另一种
 * compact=false：两按钮并排
 */
export function LanguageSwitcher({ compact = true }: Props) {
  const { locale, setLocale, t } = useI18n()

  if (compact) {
    const next: Locale = locale === 'zh' ? 'en' : 'zh'
    return (
      <button
        onClick={() => setLocale(next)}
        title={t('locale.switchTo', { target: LABELS[next].long })}
        style={{
          padding: '4px 9px',
          fontSize: 11.5,
          fontWeight: 600,
          background: 'transparent',
          border: '1px solid var(--separator)',
          borderRadius: 6,
          color: 'var(--label-secondary)',
          cursor: 'pointer',
          fontFamily: 'var(--sans)',
          transition: 'background 0.15s, color 0.15s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--gray-5)'
          e.currentTarget.style.color = 'var(--label)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = 'var(--label-secondary)'
        }}
      >
        {LABELS[locale].short}
      </button>
    )
  }

  return (
    <div style={{ display: 'inline-flex', gap: 4, padding: 2, background: 'var(--gray-6)', borderRadius: 8 }}>
      {(['zh', 'en'] as Locale[]).map((l) => {
        const active = locale === l
        return (
          <button
            key={l}
            onClick={() => setLocale(l)}
            style={{
              padding: '4px 10px',
              fontSize: 12,
              fontWeight: 600,
              background: active ? 'white' : 'transparent',
              boxShadow: active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
              border: 'none',
              borderRadius: 6,
              color: active ? 'var(--label)' : 'var(--label-secondary)',
              cursor: 'pointer',
              fontFamily: 'var(--sans)',
            }}
          >
            {LABELS[l].long}
          </button>
        )
      })}
    </div>
  )
}
