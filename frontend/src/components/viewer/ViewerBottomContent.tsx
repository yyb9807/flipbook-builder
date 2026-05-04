import type { FlipNode } from '../../types'
import { useI18n } from '../../i18n'

interface Props {
  node: FlipNode
  /** 从根到当前的路径（含当前节点），用于面包屑 */
  path: { id: string; title: string }[]
}

/** Viewer 模式底部：面包屑 + 标题 + 描述 + "继续探索"提示。 */
export function ViewerBottomContent({ node, path }: Props) {
  const { t } = useI18n()
  const linkedCount = node.hotspots.filter((h) => h.target_node_id).length

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: '28px 36px 40px',
        zIndex: 20,
        color: 'white',
        pointerEvents: 'none',
      }}
    >
      <Breadcrumb path={path} />

      <h1
        style={{
          fontWeight: 700,
          fontSize: 52,
          letterSpacing: '-0.035em',
          lineHeight: 1,
          margin: '0 0 10px',
          maxWidth: 700,
        }}
      >
        {node.title}
      </h1>

      {node.description && (
        <p
          style={{
            fontSize: 16,
            opacity: 0.9,
            margin: 0,
            maxWidth: 520,
            lineHeight: 1.45,
            fontWeight: 400,
          }}
        >
          {node.description}
        </p>
      )}

      {linkedCount > 0 && (
        <p
          style={{
            fontSize: 12,
            opacity: 0.5,
            margin: '12px 0 0',
            fontWeight: 500,
            letterSpacing: '-0.005em',
          }}
        >
          {t('viewer.continueHint')}
        </p>
      )}
    </div>
  )
}

function Breadcrumb({ path }: { path: { id: string; title: string }[] }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: 14,
        fontSize: 12,
        color: 'rgba(255,255,255,0.7)',
        fontWeight: 600,
      }}
    >
      {path.map((p, i) => (
        <span key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {i > 0 && <span style={{ opacity: 0.4 }}>/</span>}
          <span style={{ color: i === path.length - 1 ? 'white' : 'rgba(255,255,255,0.7)' }}>
            {p.title}
          </span>
        </span>
      ))}
    </div>
  )
}
