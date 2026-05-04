import type { ReactNode } from 'react'
import type { ModelTone } from '../../utils/llmProviders'

const TONE_BG: Record<ModelTone, string> = {
  green: 'var(--green)',
  blue: 'var(--blue)',
  gray: 'var(--gray-3)',
}

export interface ChipProps {
  /** 主文案 */
  label: string
  /** 是否高亮选中 */
  active?: boolean
  /** 选中时的背景色调；默认 blue */
  tone?: ModelTone
  /** 副文案（如速度提示） */
  hint?: string
  /** 是否在右上角显示推荐 ★（active 时不显示） */
  recommended?: boolean
  /** 字体（mono 给 model id；sans 给厂商名） */
  font?: 'mono' | 'sans'
  /** 尺寸（sm 给 model chip，md 给 provider chip） */
  size?: 'sm' | 'md'
  /** 按钮 title 提示 */
  title?: string
  onClick?: () => void
  /** 自定义 children（覆盖 label/hint） */
  children?: ReactNode
}

/**
 * 设置页通用 chip 按钮（model preset / provider preset 复用）。
 * 抽出来前同样的样式在 ChatModelPresets / ImgModelPresets / ProviderPicker 写了 3 遍。
 */
export function Chip({
  label,
  active = false,
  tone = 'blue',
  hint,
  recommended,
  font = 'mono',
  size = 'sm',
  title,
  onClick,
  children,
}: ChipProps) {
  const padding = size === 'md' ? '6px 12px' : '5px 10px'
  const fontSize = size === 'md' ? 12.5 : 12
  const fontWeight = size === 'md' ? 600 : 400
  const fontFamily = font === 'mono' ? 'var(--mono)' : 'var(--sans)'
  const borderRadius = size === 'md' ? 8 : 6

  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        padding,
        fontSize,
        fontWeight,
        fontFamily,
        background: active ? TONE_BG[tone] : 'var(--gray-5)',
        color: active ? 'white' : 'var(--label-secondary)',
        border: 'none',
        borderRadius,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        transition: 'background 0.15s',
      }}
    >
      {children ?? (
        <>
          <span>{label}</span>
          {recommended && !active && (
            <span style={{ fontSize: 10, color: 'var(--blue)', fontWeight: 700 }}>★</span>
          )}
          {hint && (
            <span style={{ fontSize: 10.5, opacity: active ? 0.85 : 0.6, fontWeight: 500 }}>
              {hint.split(' · ')[0]}
            </span>
          )}
        </>
      )}
    </button>
  )
}
