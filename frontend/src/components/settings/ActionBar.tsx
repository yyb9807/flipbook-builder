import { useI18n } from '../../i18n'

interface Props {
  saved: boolean
  testing: boolean
  dirty: boolean
  onSave: () => void
  onTest: () => void
}

/**
 * 设置页底部操作条：「未保存提示 + 测试 + 保存」三状态合一。
 * 用普通 flex 布局，避免 sticky + backdrop-filter + flex 容器组合带来的点击异常。
 */
export function ActionBar({ saved, testing, dirty, onSave, onTest }: Props) {
  const { t } = useI18n()
  return (
    <div
      style={{
        marginTop: 16,
        marginBottom: 24,
        padding: '14px 16px',
        background: 'var(--bg-elev)',
        borderRadius: 12,
        boxShadow: 'var(--shadow-card)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <DirtyIndicator dirty={dirty} saved={saved} />
      <div style={{ flex: 1 }} />
      <button
        type="button"
        onClick={onTest}
        disabled={testing}
        style={{
          padding: '10px 18px',
          background: testing ? 'var(--gray-5)' : 'transparent',
          border: '1.5px solid var(--blue)',
          borderRadius: 10,
          fontWeight: 600,
          fontSize: 14,
          color: testing ? 'var(--label-tertiary)' : 'var(--blue)',
          cursor: testing ? 'wait' : 'pointer',
          fontFamily: 'var(--sans)',
          transition: 'background 0.15s',
        }}
      >
        {testing ? t('settings.action.testing') : t('settings.action.test')}
      </button>
      <button
        type="button"
        onClick={onSave}
        style={{
          padding: '10px 22px',
          background: saved ? 'var(--green)' : 'var(--blue)',
          border: 'none',
          borderRadius: 10,
          fontWeight: 600,
          fontSize: 14,
          color: 'white',
          cursor: 'pointer',
          fontFamily: 'var(--sans)',
          transition: 'background 0.2s',
        }}
      >
        {saved ? t('settings.action.saved') : t('settings.action.save')}
      </button>
    </div>
  )
}

function DirtyIndicator({ dirty, saved }: { dirty: boolean; saved: boolean }) {
  const { t } = useI18n()
  if (saved) {
    return (
      <span style={{ fontSize: 12.5, color: 'var(--green)', fontWeight: 500 }}>
        {t('settings.action.savedHint')}
      </span>
    )
  }
  if (dirty) {
    return (
      <span
        style={{
          fontSize: 12.5,
          color: 'var(--orange)',
          fontWeight: 500,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: 'var(--orange)',
            display: 'inline-block',
          }}
        />
        {t('settings.action.dirty')}
      </span>
    )
  }
  return (
    <span style={{ fontSize: 12.5, color: 'var(--label-tertiary)' }}>
      {t('settings.action.privacyHint')}
    </span>
  )
}
