import { useState, type ReactNode } from 'react'

interface Props {
  /** 折叠标题（按钮文字） */
  label: string
  /** 默认是否展开 */
  defaultOpen?: boolean
  children: ReactNode
}

/**
 * 简单的折叠容器，用于"高级 / 自定义 Base URL"这类大多数用户不需要看到的选项。
 * 用受控 state 而非原生 <details>，方便控制 defaultOpen 和样式一致性。
 */
export function Collapse({ label, defaultOpen = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ marginTop: 4 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          background: 'none',
          border: 'none',
          padding: '6px 0',
          fontSize: 12.5,
          color: 'var(--label-secondary)',
          fontWeight: 500,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: 'var(--sans)',
        }}
      >
        <span
          style={{
            display: 'inline-block',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s',
            fontSize: 10,
          }}
        >
          ▶
        </span>
        {label}
      </button>
      {open && <div style={{ paddingTop: 6 }}>{children}</div>}
    </div>
  )
}
