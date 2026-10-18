import { useId, type ReactNode } from 'react'

interface Props {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  placeholder?: string
  below?: ReactNode
  labelHint?: ReactNode
}

export function SettingField({ label, value, onChange, type = 'text', placeholder, below, labelHint }: Props) {
  const id = useId()
  return (
    <div className="settings-field">
      <div className="settings-field-heading">
        <label htmlFor={id}>{label}</label>
        {labelHint && <span id={`${id}-hint`}>{labelHint}</span>}
      </div>
      <input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby={labelHint ? `${id}-hint` : undefined} />
      {below && <div className="settings-field-presets">{below}</div>}
    </div>
  )
}
