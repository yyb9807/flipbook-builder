import type { KeyboardEvent } from 'react'
import type { FlipNode } from '../../types'
import { Icon } from '../shared/Icon'
import { useI18n } from '../../i18n'

interface Props {
  childIds: string[]
  nodesById: Record<string, FlipNode>
  onOpen: (childId: string) => void
  onRegenerate?: (childId: string) => void
}

/** 当前页下方显示子页面缩略图（最多 3 列）。点击进入子页，hover 显示 ↻ 重新生成。 */
export function ChildThumbnails({ childIds, nodesById, onOpen, onRegenerate }: Props) {
  const { t } = useI18n()
  if (childIds.length === 0) return null

  function handleKey(e: KeyboardEvent<HTMLDivElement>, id: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen(id)
    }
  }

  return (
    <div style={{ marginTop: 16 }}>
      <p
        style={{
          fontSize: 12,
          color: 'var(--label-tertiary)',
          marginBottom: 10,
          fontWeight: 500,
          letterSpacing: '-0.005em',
        }}
      >
        {t('builder.children.title')}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {childIds.map((childId) => {
          const child = nodesById[childId]
          if (!child) return null
          return (
            <div
              key={childId}
              role="button"
              tabIndex={0}
              aria-label={t('builder.children.openLabel', { name: child.title })}
              className="child-thumb"
              onClick={() => onOpen(childId)}
              onKeyDown={(e) => handleKey(e, childId)}
              style={{
                background: 'var(--bg-elev)',
                border: 'none',
                borderRadius: 14,
                overflow: 'hidden',
                aspectRatio: '4/3',
                cursor: 'pointer',
                position: 'relative',
                boxShadow: 'var(--shadow-card)',
                padding: 0,
                transition: 'transform 0.15s',
                outline: 'none',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-2px)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
            >
              {child.image_url ? (
                <img
                  src={child.image_url}
                  alt={child.title}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: child.status === 'generated' ? 'rgba(255,149,0,0.12)' : 'var(--gray-5)',
                    color: child.status === 'generated' ? 'var(--orange)' : 'var(--label-tertiary)',
                    fontSize: 11.5,
                    padding: 8,
                    textAlign: 'center',
                    fontWeight: child.status === 'generated' ? 600 : 400,
                  }}
                >
                  {child.status === 'generated' ? t('builder.children.imageFailed', { name: child.title }) : child.title}
                </div>
              )}
              <div
                style={{
                  position: 'absolute',
                  inset: '50% 0 0',
                  background: 'linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 100%)',
                  display: 'flex',
                  alignItems: 'flex-end',
                  padding: '0 8px 8px',
                  pointerEvents: 'none',
                }}
              >
                <p
                  style={{
                    color: 'white',
                    fontSize: 11.5,
                    fontWeight: 600,
                    margin: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    width: '100%',
                  }}
                >
                  {child.title}
                </p>
              </div>
              {onRegenerate && (
                <button
                  type="button"
                  className="child-thumb-regen"
                  aria-label={t('builder.children.regenerateLabel', { name: child.title })}
                  title={t('builder.tree.regenerateTooltip')}
                  onClick={(e) => {
                    e.stopPropagation()
                    onRegenerate(childId)
                  }}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <Icon name="refresh" size={12} stroke={2} />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
