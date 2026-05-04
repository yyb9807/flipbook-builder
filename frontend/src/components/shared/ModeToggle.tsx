import { useProjectStore } from '../../store/projectStore'
import { useI18n } from '../../i18n'

export function ModeToggle() {
  const { t } = useI18n()
  const mode = useProjectStore((s) => s.mode)
  const setMode = useProjectStore((s) => s.setMode)
  const project = useProjectStore((s) => s.project)

  if (!project?.root_node_id) return null

  if (mode === 'viewer') {
    return (
      <button
        onClick={() => setMode('builder')}
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
        }}
      >
        {t('mode.editor')}
      </button>
    )
  }

  return (
    <button
      onClick={() => setMode('viewer')}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 14px',
        background: 'var(--pink)',
        border: 'none',
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 600,
        color: 'white',
        cursor: 'pointer',
      }}
    >
      {t('mode.viewer')}
    </button>
  )
}
