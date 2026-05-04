/**
 * Vitest setup —— 全局测试初始化。
 * 引入 @testing-library/jest-dom 让 expect(el).toBeInTheDocument() 等 matcher 可用。
 */
import '@testing-library/jest-dom/vitest'

// jsdom 在某些版本下 localStorage 的 setItem/getItem 不是真函数（引擎内部实现）。
// zustand persist 中间件需要它们能调用，给个干净的 in-memory polyfill。
const memoryStorage: Record<string, string> = {}
const stubStorage = {
  getItem: (k: string) => (k in memoryStorage ? memoryStorage[k] : null),
  setItem: (k: string, v: string) => {
    memoryStorage[k] = v
  },
  removeItem: (k: string) => {
    delete memoryStorage[k]
  },
  clear: () => {
    for (const k of Object.keys(memoryStorage)) delete memoryStorage[k]
  },
  key: (i: number) => Object.keys(memoryStorage)[i] ?? null,
  get length() {
    return Object.keys(memoryStorage).length
  },
}
Object.defineProperty(globalThis, 'localStorage', {
  value: stubStorage,
  writable: true,
})

// 测试断言基本上写的是中文，预置 i18n locale = 'zh' 到 stubStorage，
// 让 zustand persist 在 store 初始化时读到中文，绕过 navigator.language 探测。
stubStorage.setItem('flipbook-locale', JSON.stringify({ state: { locale: 'zh' }, version: 0 }))
