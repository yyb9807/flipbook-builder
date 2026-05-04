import type { ReactNode } from 'react'

interface Props {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  /** 紧跟字段下方的内容（例如模型选择按钮） */
  below?: ReactNode
  /** 标签右侧的提示（如已保存的 key 摘要、字符数等） */
  labelHint?: ReactNode
}

/** 设置页的通用输入字段：标签 + input + 焦点高亮，支持 label 行右侧 hint 槽。 */
export function SettingField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  below,
  labelHint,
}: Props) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 6,
        }}
      >
        <label
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: 'var(--label-secondary)',
            letterSpacing: '0.01em',
          }}
        >
          {label}
        </label>
        {labelHint && (
          <span
            style={{
              fontSize: 11.5,
              color: 'var(--label-tertiary)',
              fontFamily: 'var(--mono)',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {labelHint}
          </span>
        )}
      </div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%',
          padding: '10px 13px',
          background: 'var(--gray-6)',
          border: '1px solid transparent',
          borderRadius: 10,
          fontSize: 14,
          color: 'var(--label)',
          outline: 'none',
          fontFamily: type === 'password' ? 'var(--mono)' : 'var(--sans)',
          transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s',
          boxSizing: 'border-box',
        }}
        onFocus={(e) => {
          e.target.style.background = 'white'
          e.target.style.borderColor = 'var(--blue)'
          e.target.style.boxShadow = '0 0 0 3px rgba(0,122,255,0.18)'
        }}
        onBlur={(e) => {
          e.target.style.background = 'var(--gray-6)'
          e.target.style.borderColor = 'transparent'
          e.target.style.boxShadow = 'none'
        }}
      />
      {below}
    </div>
  )
}
