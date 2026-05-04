import type { ReactNode } from 'react'

type Tone = 'blue' | 'pink'
type Status = 'ok' | 'missing' | 'idle'

const TONE: Record<Tone, { bar: string; dot: string; bg: string }> = {
  blue: { bar: 'var(--blue)', dot: 'var(--blue)', bg: 'rgba(0,122,255,0.06)' },
  pink: { bar: 'var(--pink)', dot: 'var(--pink)', bg: 'rgba(255,45,85,0.06)' },
}

const STATUS_LABEL: Record<Status, { text: string; color: string; bg: string } | null> = {
  ok: { text: '已配置', color: 'var(--green)', bg: 'rgba(52,199,89,0.12)' },
  missing: { text: '缺 API Key', color: 'var(--orange)', bg: 'rgba(255,149,0,0.12)' },
  idle: null,
}

interface Props {
  title: string
  subtitle?: string
  tone?: Tone
  status?: Status
  children: ReactNode
}

/**
 * 设置页章节容器：取代原 ConfigCard 的"图标+卡片"重装饰，用极简的色条 + 状态徽章。
 * 设计目标：减少视觉嵌套、保留分组语义、突出"是否配置完成"。
 */
export function Section({ title, subtitle, tone = 'blue', status = 'idle', children }: Props) {
  const t = TONE[tone]
  const badge = STATUS_LABEL[status]

  return (
    <section
      style={{
        background: 'var(--bg-elev)',
        borderRadius: 14,
        padding: '18px 20px 20px',
        marginBottom: 14,
        boxShadow: 'var(--shadow-card)',
        borderLeft: `3px solid ${t.bar}`,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
            {title}
          </h2>
          {subtitle && (
            <span
              style={{
                fontSize: 12.5,
                color: 'var(--label-secondary)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {subtitle}
            </span>
          )}
        </div>
        {badge && (
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              color: badge.color,
              background: badge.bg,
              padding: '3px 9px',
              borderRadius: 999,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {badge.text}
          </span>
        )}
      </header>
      {children}
    </section>
  )
}
