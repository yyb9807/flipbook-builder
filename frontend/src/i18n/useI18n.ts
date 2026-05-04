import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { TRANSLATIONS, SUPPORTED_LOCALES } from './translations'
import type { Locale, TranslationKey } from './translations'

/** 浏览器首次加载时检测：以 navigator.language 推断；非中文系都落到英文。 */
function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return 'zh'
  const lang = (navigator.language || '').toLowerCase()
  if (lang.startsWith('zh')) return 'zh'
  return 'en'
}

interface I18nState {
  locale: Locale
  setLocale: (l: Locale) => void
}

export const useI18nStore = create<I18nState>()(
  persist(
    (set) => ({
      locale: detectLocale(),
      setLocale: (l) => set({ locale: l }),
    }),
    {
      name: 'flipbook-locale',
      // 旧版本可能存了非法值，做个保护
      onRehydrateStorage: () => (state) => {
        if (state && !SUPPORTED_LOCALES.includes(state.locale)) {
          state.locale = detectLocale()
        }
      },
    },
  ),
)

/**
 * 翻译函数：根据当前 locale 取字符串，支持 {placeholder} 注入。
 * key 不存在时返回 key 本身（方便开发期发现遗漏）。
 */
export function translate(locale: Locale, key: TranslationKey, vars?: Record<string, string | number>): string {
  const entry = TRANSLATIONS[key]
  if (!entry) {
    if (import.meta.env.DEV) console.warn(`[i18n] missing key: ${key}`)
    return key
  }
  let text: string = entry[locale] ?? entry.zh
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }
  return text
}

/**
 * React hook：返回 t(key, vars) 函数 + 当前 locale + 切换器。
 * 组件订阅 locale 变化自动重渲。
 */
export function useI18n() {
  const locale = useI18nStore((s) => s.locale)
  const setLocale = useI18nStore((s) => s.setLocale)
  const t = (key: TranslationKey, vars?: Record<string, string | number>) => translate(locale, key, vars)
  return { t, locale, setLocale }
}
