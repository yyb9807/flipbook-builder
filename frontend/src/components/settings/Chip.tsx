import type { ReactNode } from 'react'
import type { ModelTone } from '../../utils/llmProviders'

export interface ChipProps {
  label: string
  active?: boolean
  tone?: ModelTone
  hint?: string
  recommended?: boolean
  font?: 'mono' | 'sans'
  size?: 'sm' | 'md'
  title?: string
  onClick?: () => void
  children?: ReactNode
}

export function Chip({ label, active = false, hint, title, onClick, children }: ChipProps) {
  return (
    <button type="button" className="settings-chip" aria-pressed={active} onClick={onClick} title={title}>
      {children ?? <><span>{label}</span>{hint && <span className="settings-chip-hint">{hint.split(' · ')[0]}</span>}</>}
    </button>
  )
}
