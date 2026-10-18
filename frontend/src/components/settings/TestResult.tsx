import type { ConfigTestEntry, TestConfigResult } from '../../types/api'
import { useI18n } from '../../i18n'
import type { TranslationKey } from '../../i18n'
import { Icon } from '../shared/Icon'

export function TestResult({ result, error }: { result: TestConfigResult | null; error: string | null }) {
  const { t } = useI18n()
  if (error) return <div className="settings-test-result settings-test-error" role="alert">{t('settings.test.failed', { error })}</div>
  if (!result) return null
  return (
    <div className="settings-test-result" role="status">
      <ResultRow labelKey="settings.test.labelLlm" item={result.llm} />
      <ResultRow labelKey="settings.test.labelImg" item={result.imggen} />
    </div>
  )
}

function ResultRow({ labelKey, item }: { labelKey: TranslationKey; item: ConfigTestEntry }) {
  const { t } = useI18n()
  return (
    <div>
      <div className="settings-result-heading">
        <Icon name={item.ok ? 'check' : 'warning'} size={16} />
        <strong>{t(labelKey)} · {t(item.ok ? 'settings.test.ok' : 'settings.test.notOk')}</strong>
        <span>{item.model}{item.latency_ms != null && ` · ${item.latency_ms} ms`}</span>
      </div>
      {item.error && <p className={item.ok ? undefined : 'settings-test-error'}>{item.error}</p>}
      {item.ok && item.sample && <p>{t('settings.test.modelReply', { sample: item.sample })}</p>}
    </div>
  )
}
