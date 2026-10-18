import { useI18n } from '../../i18n'

export function QuickStartHint({ hasLlmKey, hasImgKey }: { hasLlmKey: boolean; hasImgKey: boolean }) {
  const { t } = useI18n()
  if (hasLlmKey || hasImgKey) return null
  return <aside className="settings-quick-start"><p>{t('settings.quickStart.steps')}</p></aside>
}
