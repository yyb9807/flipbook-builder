import { useId, type ReactNode } from 'react'
import { useI18n } from '../../i18n'

interface Props {
  title: string
  subtitle?: string
  tone?: 'blue' | 'pink'
  status?: 'ok' | 'missing' | 'idle'
  children: ReactNode
}

export function Section({ title, subtitle, status = 'idle', children }: Props) {
  const { t } = useI18n()
  const id = useId()
  return (
    <section className="settings-section" aria-labelledby={id}>
      <header className="settings-section-heading">
        <div><h2 id={id}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        {status !== 'idle' && <span className={`settings-status settings-status-${status}`}>{t(status === 'ok' ? 'settings.status.ok' : 'settings.status.missing')}</span>}
      </header>
      {children}
    </section>
  )
}
