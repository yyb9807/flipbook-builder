import { useProjectStore } from '../../store/projectStore'
import type { FlipNode } from '../../types'
import { Icon } from '../shared/Icon'
import { useI18n } from '../../i18n'

interface Props {
  /** 行 hover 时显示「↻ 重新生成此页」的回调；不传则不显示按钮。 */
  onRegenerate?: (nodeId: string) => void
}

export function TreeNav({ onRegenerate }: Props = {}) {
  const { t } = useI18n()
  const project = useProjectStore((s) => s.project)
  const activeNodeId = useProjectStore((s) => s.activeNodeId)
  const navigateTo = useProjectStore((s) => s.navigateTo)
  const navigateBack = useProjectStore((s) => s.navigateBack)
  const navigationStack = useProjectStore((s) => s.navigationStack)

  if (!project) return (
    <div
      style={{
        background: 'var(--bg-elev)',
        borderRadius: 16,
        boxShadow: 'var(--shadow-card)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        height: '100%',
      }}
    >
      <div style={{ padding: '14px 16px 8px', borderBottom: '0.5px solid var(--separator)' }}>
        <h3 style={{ margin: 0, fontWeight: 700, fontSize: 17, letterSpacing: '-0.02em' }}>{t('builder.tree.title')}</h3>
      </div>
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--label-tertiary)',
          fontSize: 13,
        }}
      >
        {t('builder.tree.empty')}
      </div>
    </div>
  )

  const totalPages = Object.keys(project.nodes).length
  const maxDepth = Math.max(...Object.values(project.nodes).map((n: FlipNode) => n.depth), 0)

  function renderNode(nodeId: string, d = 0): React.ReactNode {
    const node = project!.nodes[nodeId]
    if (!node) return null
    const isActive = nodeId === activeNodeId

    return (
      <div key={nodeId}>
        <div
          className={`tree-node${isActive ? ' active' : ''}`}
          onClick={() => navigateTo(nodeId)}
        >
          <div className="tree-thumb">
            {node.image_url && (
              <img
                src={node.image_url}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            )}
          </div>
          <span className="tree-label">
            {node.title.length > 14 ? node.title.slice(0, 14) + '…' : node.title}
          </span>
          <span className="tree-depth-tag">L{d}</span>
          {onRegenerate && d > 0 && (
            <button
              type="button"
              className="tree-regen"
              aria-label={t('builder.tree.regenerateLabel', { name: node.title })}
              title={t('builder.tree.regenerateTooltip')}
              onClick={(e) => {
                e.stopPropagation()
                onRegenerate(nodeId)
              }}
            >
              <Icon name="refresh" size={11} stroke={2} />
            </button>
          )}
        </div>

        {/* Children */}
        {node.children.length > 0 && (
          <div
            style={{
              marginLeft: 22,
              borderLeft: '1px solid var(--separator-soft)',
              paddingLeft: 10,
            }}
          >
            {node.children.map((childId) => renderNode(childId, d + 1))}
          </div>
        )}
      </div>
    )
  }

  const rootId = project.root_node_id

  return (
    <div
      style={{
        background: 'var(--bg-elev)',
        borderRadius: 16,
        boxShadow: 'var(--shadow-card)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        height: '100%',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '14px 16px 8px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '0.5px solid var(--separator)',
        }}
      >
        <h3 style={{ margin: 0, fontWeight: 700, fontSize: 17, letterSpacing: '-0.02em' }}>{t('builder.tree.title')}</h3>
        {navigationStack.length > 1 && (
          <button onClick={navigateBack} className="btn btn-sm">
            <Icon name="arrow-left" size={11} />
            {t('builder.tree.back')}
          </button>
        )}
      </div>

      {/* Tree body */}
      <div style={{ flex: 1, padding: '4px 10px 12px', overflowY: 'auto' }}>
        {rootId && renderNode(rootId)}
      </div>

      {/* Stats */}
      <div
        style={{
          padding: 10,
          borderTop: '0.5px solid var(--separator)',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 6,
        }}
      >
        <div style={{ background: 'var(--gray-6)', borderRadius: 10, padding: '8px 12px' }}>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.1 }}>
            {totalPages}
          </div>
          <div style={{ color: 'var(--label-secondary)', fontSize: 11, marginTop: 1, fontWeight: 500 }}>
            {t('builder.tree.pages')}
          </div>
        </div>
        <div style={{ background: 'var(--gray-6)', borderRadius: 10, padding: '8px 12px' }}>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.1 }}>
            L{maxDepth}
          </div>
          <div style={{ color: 'var(--label-secondary)', fontSize: 11, marginTop: 1, fontWeight: 500 }}>
            {t('builder.tree.depth')}
          </div>
        </div>
      </div>
    </div>
  )
}
