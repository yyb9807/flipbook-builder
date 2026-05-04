import type { ConfigTestEntry, TestConfigResult } from '../../types/api'
import { useI18n } from '../../i18n'
import type { TranslationKey } from '../../i18n'

interface Props {
  result: TestConfigResult | null
  error: string | null
}

/** 显示「测试连接」的结果或错误。 */
export function TestResult({ result, error }: Props) {
  const { t } = useI18n()
  if (error) {
    return (
      <div
        style={{
          marginTop: 12,
          padding: '12px 14px',
          background: 'rgba(255,59,48,0.1)',
          borderRadius: 10,
          fontSize: 13,
          color: 'var(--red)',
        }}
      >
        {t('settings.test.failed', { error })}
      </div>
    )
  }
  if (!result) return null

  return (
    <div
      style={{
        marginTop: 12,
        padding: '14px 16px',
        background: 'var(--bg-elev)',
        borderRadius: 12,
        fontSize: 13,
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <ResultRow labelKey="settings.test.labelLlm" item={result.llm} />
      <div style={{ height: 8 }} />
      <ResultRow labelKey="settings.test.labelImg" item={result.imggen} />
    </div>
  )
}

function ResultRow({ labelKey, item }: { labelKey: TranslationKey; item: ConfigTestEntry }) {
  const { t } = useI18n()
  const ok = item.ok
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: ok ? 'var(--green)' : 'var(--red)',
            color: 'white',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          {ok ? '✓' : '✕'}
        </span>
        <b style={{ fontSize: 14 }}>{t(labelKey)}</b>
        <span style={{ color: 'var(--label-tertiary)', fontSize: 12 }}>
          {item.model} · {t('settings.test.keyChars', { n: item.key_length })}
          {item.latency_ms != null && ` · ${item.latency_ms}ms`}
        </span>
      </div>
      {item.error && (
        <div
          style={{
            fontSize: 12,
            color: ok ? 'var(--label-secondary)' : 'var(--red)',
            fontFamily: 'var(--mono)',
            paddingLeft: 26,
            wordBreak: 'break-all',
          }}
        >
          {item.error}
        </div>
      )}
      {ok && item.sample && (
        <div
          style={{
            fontSize: 12,
            color: 'var(--label-secondary)',
            fontFamily: 'var(--mono)',
            paddingLeft: 26,
          }}
        >
          {t('settings.test.modelReply', { sample: item.sample })}
        </div>
      )}
    </div>
  )
}
