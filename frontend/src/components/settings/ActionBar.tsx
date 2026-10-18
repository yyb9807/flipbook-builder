import { useI18n } from '../../i18n'

interface Props {
  saved: boolean
  testing: boolean
  dirty: boolean
  onSave: () => void
  onTest: () => void
}

export function ActionBar({ saved, testing, dirty, onSave, onTest }: Props) {
  const { t } = useI18n()
  return (
    <div className="settings-actions">
      <span className="settings-save-status" role="status">{dirty ? t('settings.action.dirty') : saved ? t('settings.action.savedHint') : t('settings.action.privacyHint')}</span>
      <div className="settings-action-buttons">
        <button type="button" className="settings-secondary" onClick={onTest} disabled={testing}>{testing ? t('settings.action.testing') : t('settings.action.test')}</button>
        <button type="button" className="settings-primary" onClick={onSave} disabled={!dirty}>{saved && !dirty ? t('settings.action.saved') : t('settings.action.save')}</button>
      </div>
    </div>
  )
}
