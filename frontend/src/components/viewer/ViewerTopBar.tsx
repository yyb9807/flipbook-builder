import { Icon } from '../shared/Icon'
import { useI18n } from '../../i18n'

interface Props {
  showBack: boolean
  onBack: () => void
  onExit: () => void
}

const PILL_BASE = {
  background: 'rgba(255,255,255,0.18)',
  backdropFilter: 'saturate(180%) blur(24px)',
  WebkitBackdropFilter: 'saturate(180%) blur(24px)',
  borderRadius: 999,
  padding: '8px 14px',
  color: 'white',
  fontSize: 13.5,
  fontWeight: 600,
  border: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  letterSpacing: '-0.01em',
  fontFamily: 'var(--sans)',
} as const

/** Viewer 模式顶栏：返回（深层节点）+ 状态徽章 + 退出到创作。 */
export function ViewerTopBar({ showBack, onBack, onExit }: Props) {
  const { t } = useI18n()
  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        left: 16,
        right: 16,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        zIndex: 20,
        gap: 10,
      }}
    >
      {showBack ? (
        <button onClick={onBack} style={{ ...PILL_BASE, cursor: 'pointer' }}>
          <Icon name="arrow-left" size={14} />
          {t('viewer.back')}
        </button>
      ) : (
        <div />
      )}

      <div style={{ ...PILL_BASE }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--pink)', flexShrink: 0 }} />
        {t('viewer.title', { app: t('common.appName') })}
      </div>

      <button
        onClick={onExit}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 14px',
          background: 'var(--gray-6)',
          border: 'none',
          borderRadius: 999,
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--label)',
          cursor: 'pointer',
          fontFamily: 'var(--sans)',
        }}
      >
        {t('viewer.exit')}
      </button>
    </div>
  )
}
