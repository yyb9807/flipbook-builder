import { Link } from 'react-router-dom'
import { useSettingsStore } from '../../store/settingsStore'
import { useI18n } from '../../i18n'

/** 当 LLM Key 未配置时显示的橙色警告条；已配置时返回 null。 */
export function ApiKeyWarning() {
  const llmApiKey = useSettingsStore((s) => s.llmApiKey)
  const { t } = useI18n()
  if (llmApiKey) return null

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '7px 20px',
        background: 'rgba(255,149,0,0.1)',
        borderBottom: '0.5px solid rgba(255,149,0,0.25)',
        // 与 Topbar 同 stacking 层级，避免被画布盖住
        position: 'relative',
        zIndex: 29,
      }}
    >
      <span style={{ fontSize: 13, color: 'var(--orange)', fontWeight: 500 }}>
        {t('apiKeyWarning.short')}
      </span>
      <Link
        to="/settings"
        style={{ fontSize: 13, color: 'var(--orange)', textDecoration: 'underline' }}
      >
        {t('apiKeyWarning.go')}
      </Link>
    </div>
  )
}
