import { LLM_PROVIDERS } from '../../utils/llmProviders'
import { useI18n } from '../../i18n'
import type { TranslationKey } from '../../i18n'

interface Props {
  hasLlmKey: boolean
  hasImgKey: boolean
}

/**
 * 首次进设置页的简洁引导：仅当两个 key 都未配置时显示。
 * 列出 2 家有 docsUrl 的官方厂商，用户点链接去注册拿 key。
 */
export function QuickStartHint({ hasLlmKey, hasImgKey }: Props) {
  const { t } = useI18n()
  // 任意一个 key 已配置就隐藏（避免重复打扰）
  if (hasLlmKey || hasImgKey) return null

  const recommended = LLM_PROVIDERS.filter((p) => p.docsUrl).slice(0, 2)

  return (
    <div
      style={{
        background: 'rgba(0,122,255,0.06)',
        border: '0.5px solid rgba(0,122,255,0.18)',
        borderRadius: 12,
        padding: '12px 14px',
        marginBottom: 16,
        fontSize: 13,
        lineHeight: 1.55,
        color: 'var(--label)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
      }}
    >
      <span style={{ fontSize: 16, lineHeight: 1.2 }}>👋</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, marginBottom: 2 }}>{t('settings.quickStart.title')}</div>
        <div style={{ color: 'var(--label-secondary)', fontSize: 12.5 }}>
          {t('settings.quickStart.steps')}
        </div>
        <div style={{ marginTop: 6, fontSize: 12.5 }}>
          {t('settings.quickStart.noKey')}
          {recommended.map((p, i) => (
            <span key={p.id}>
              {i > 0 && <span style={{ color: 'var(--label-tertiary)' }}> · </span>}
              <a
                href={p.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--blue)', textDecoration: 'none', fontWeight: 500 }}
              >
                {t(`provider.${p.id}` as TranslationKey)}
              </a>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
