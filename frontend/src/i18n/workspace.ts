import { useI18n } from './useI18n'

export function useCopy() {
  const { locale } = useI18n()
  return (zh: string, en: string) => locale === 'zh' ? zh : en
}
