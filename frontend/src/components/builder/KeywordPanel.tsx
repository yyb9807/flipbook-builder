import type { Keyword } from '../../types'
import { useI18n } from '../../i18n'

interface Props {
  keywords: Keyword[]
  selected: string[]
  onToggle: (label: string) => void
}

export function KeywordPanel({ keywords, selected, onToggle }: Props) {
  const { t } = useI18n()
  if (keywords.length === 0) return null

  return (
    <div style={{ padding: '12px 16px', borderTop: '0.5px solid var(--separator)' }}>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: '-0.01em',
          color: 'var(--label)',
          marginBottom: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span>{t('builder.keyword.step2')}</span>
        {selected.length > 0 && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--purple)', background: 'rgba(175,82,222,0.12)', padding: '2px 7px', borderRadius: 6 }}>
            {t('builder.keyword.selected', { n: selected.length })}
          </span>
        )}
      </div>
      <p style={{ fontSize: 12, color: 'var(--label-tertiary)', margin: '0 0 10px', lineHeight: 1.4 }}>
        {t('builder.keyword.hint')}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {keywords.map((kw) => {
          const isSelected = selected.includes(kw.label)
          return (
            <button
              key={kw.label}
              onClick={() => onToggle(kw.label)}
              title={kw.description}
              style={{
                padding: '4px 10px',
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.12s',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                background: isSelected ? 'rgba(175,82,222,0.12)' : 'var(--gray-6)',
                color: isSelected ? 'var(--purple, #AF52DE)' : 'var(--label-secondary)',
                boxShadow: isSelected ? 'inset 0 0 0 1px rgba(175,82,222,0.4)' : 'inset 0 0 0 1px transparent',
                fontFamily: 'var(--sans)',
              }}
            >
              {isSelected && <span>✓</span>}
              {kw.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
