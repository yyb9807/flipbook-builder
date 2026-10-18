import { useId, type ReactNode } from 'react'
import { Icon } from '../shared/Icon'

export function Collapse({ label, open, onOpenChange, children }: { label: string; open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  const id = useId()
  return (
    <div className="settings-collapse">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => onOpenChange(!open)}>
        <Icon name={open ? 'arrow-left' : 'arrow-right'} size={14} />{label}
      </button>
      <div id={id} hidden={!open}>{children}</div>
    </div>
  )
}
