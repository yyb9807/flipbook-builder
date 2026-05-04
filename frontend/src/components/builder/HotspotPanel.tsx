import { useState } from 'react'
import type { FlipNode, Hotspot } from '../../types'
import { useProjectStore } from '../../store/projectStore'
import { api } from '../../api/client'
import { useToast } from '../shared/Toast'
import { useI18n } from '../../i18n'

interface Props {
  node: FlipNode
  onHotspotChange: (hotspot: Hotspot) => void
  projectId: string
}

export function HotspotPanel({ node, onHotspotChange, projectId }: Props) {
  const { t } = useI18n()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const { show: showToast, ToastEl } = useToast()
  const description = useProjectStore((s) =>
    s.activeNodeId ? s.project?.nodes[s.activeNodeId]?.description : undefined
  )

  /** 推送到后端，失败时给 toast（之前是 console.error 静默吞掉）。 */
  function pushUpdate(payload: { id: string; selected?: boolean; label?: string }) {
    api.updateHotspots(projectId, node.id, [payload]).catch((e) => {
      showToast(t('builder.hotspot.saveFailed', { error: (e as Error).message }), 'error')
    })
  }

  function toggleSelect(hs: Hotspot) {
    const updated = { ...hs, selected: !hs.selected }
    onHotspotChange(updated)
    pushUpdate({ id: hs.id, selected: updated.selected })
  }

  function startEdit(hs: Hotspot) {
    setEditingId(hs.id)
    setEditLabel(hs.label)
  }

  function saveEdit(hs: Hotspot) {
    if (!editLabel.trim()) return
    const updated = { ...hs, label: editLabel.trim() }
    onHotspotChange(updated)
    pushUpdate({ id: hs.id, label: updated.label })
    setEditingId(null)
  }

  const selectedCount = node.hotspots.filter((h) => h.selected).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Page summary */}
      <div
        style={{
          padding: '14px 16px',
          borderBottom: '0.5px solid var(--separator)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span
            style={{
              width: 26,
              height: 26,
              background: 'var(--pink)',
              color: 'white',
              borderRadius: 8,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 2l2 7 7 2-7 2-2 7-2-7-7-2 7-2z" />
            </svg>
          </span>
          <h3 style={{ margin: 0, fontWeight: 700, fontSize: 17, letterSpacing: '-0.02em', flex: 1 }}>
            {t('builder.hotspot.currentPage')}
          </h3>
        </div>

        {description && (
          <div
            style={{
              background: 'var(--gray-6)',
              borderRadius: 12,
              padding: '10px 12px',
              fontSize: 13,
              color: 'var(--label-secondary)',
              lineHeight: 1.45,
              fontStyle: 'italic',
              marginBottom: 8,
            }}
          >
            "{description.length > 100 ? description.slice(0, 100) + '…' : description}"
          </div>
        )}
      </div>

      {/* Hotspot suggestion rows */}
      <div style={{ padding: '14px 16px 8px', flex: 1, overflowY: 'auto' }}>
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
          <span>{t('builder.hotspot.step1')}</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--label-secondary)', background: 'var(--gray-6)', padding: '2px 7px', borderRadius: 6 }}>
            {selectedCount} / {node.hotspots.length}
          </span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--label-tertiary)', margin: '0 0 10px', lineHeight: 1.4 }}>
          {t('builder.hotspot.eachToSubpage')}
        </p>

        {node.hotspots.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              padding: '20px 14px',
              background: 'rgba(255,149,0,0.08)',
              borderRadius: 10,
              color: 'var(--orange)',
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {t('builder.hotspot.empty1')}<br />
            <span style={{ fontSize: 12, color: 'var(--label-tertiary)' }}>
              {t('builder.hotspot.empty2')}
            </span>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {node.hotspots.map((hs) => {
            const isChecked = hs.selected
            const isOnCanvas = !!hs.target_node_id

            return (
              <div
                key={hs.id}
                className={`ai-suggestion${isChecked && !isOnCanvas ? ' checked' : ''}${isOnCanvas ? ' on-canvas' : ''}`}
                onClick={() => !isOnCanvas && toggleSelect(hs)}
              >
                {/* Check circle */}
                <span className="ai-check">
                  {(isOnCanvas || isChecked) ? '✓' : ''}
                </span>

                {/* Label */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {editingId === hs.id && !isOnCanvas ? (
                    <input
                      autoFocus
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      onBlur={() => saveEdit(hs)}
                      onKeyDown={(e) => e.key === 'Enter' && saveEdit(hs)}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        width: '100%',
                        background: 'rgba(255,255,255,0.3)',
                        border: 'none',
                        borderRadius: 6,
                        padding: '2px 6px',
                        fontSize: 14,
                        color: 'white',
                        outline: 'none',
                        fontFamily: 'var(--sans)',
                      }}
                    />
                  ) : (
                    <span
                      style={{ fontSize: 14, fontWeight: 500, letterSpacing: '-0.01em' }}
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        if (!isOnCanvas) startEdit(hs)
                      }}
                    >
                      {hs.label}
                    </span>
                  )}
                  <div className="ai-sub-text">
                    {isOnCanvas
                      ? t('builder.hotspot.subpageDone')
                      : hs.score !== undefined
                        ? t('builder.hotspot.confidence', { n: Math.round(hs.score * 100) })
                        : t('builder.hotspot.dblclickToEdit')}
                  </div>
                </div>

                {/* Confidence badge */}
                {hs.score !== undefined && !isOnCanvas && (
                  <span className="ai-badge">{hs.score.toFixed(2)}</span>
                )}
              </div>
            )
          })}
        </div>
      </div>
      {ToastEl}
    </div>
  )
}
