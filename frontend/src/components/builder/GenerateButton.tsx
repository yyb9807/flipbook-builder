import { useI18n } from '../../i18n'

interface Props {
  onClick: () => void
  loading: boolean
  disabled?: boolean
  label?: string
  /** 副标签：显示在主文字下方（如"约 ¥0.5 · 60 秒"） */
  hint?: string
}

export function GenerateButton({ onClick, loading, disabled, label, hint }: Props) {
  const { t } = useI18n()
  const isDisabled = disabled || loading
  const mainLabel = label ?? t('builder.generate.label')
  return (
    <button onClick={onClick} disabled={isDisabled} className="generate-btn">
      {loading ? (
        <>
          <span
            style={{
              width: 14,
              height: 14,
              borderRadius: '50%',
              border: '2px solid rgba(255,255,255,0.4)',
              borderTopColor: 'white',
              animation: 'spin 0.8s linear infinite',
              flexShrink: 0,
            }}
          />
          {t('builder.generate.loading')}
        </>
      ) : (
        <>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 2l2 7 7 2-7 2-2 7-2-7-7-2 7-2z" />
          </svg>
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2 }}>
            <span>{mainLabel}</span>
            {hint && (
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 500,
                  opacity: 0.85,
                  fontFamily: 'var(--mono)',
                }}
              >
                {hint}
              </span>
            )}
          </span>
        </>
      )}
    </button>
  )
}
