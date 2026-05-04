import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export type ToastType = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  message: string
  type: ToastType
}

// ─────────────── 全局 Toast 单例（pub-sub）───────────────
//
// 之前 6 个组件各自 useToast()，每个挂自己的 portal。改为全局 store：
//   - <ToastHost /> 挂在 App 根处一次
//   - 任何地方 import { toast } from '...' 直接调用，不需要 hook
//
// 好处：
//   1. portal 只 mount 一次，DOM 里只有一个 toast 容器
//   2. 非 React 代码（util / store）也能弹 toast
//   3. 多条 toast 自动堆叠，而不是覆盖
let nextId = 1
const subscribers = new Set<(items: ToastItem[]) => void>()
let items: ToastItem[] = []

function notify() {
  for (const sub of subscribers) sub(items)
}

/** 命令式弹 toast。message 自动 4 秒后消失。 */
export const toast = {
  show(message: string, type: ToastType = 'info') {
    const id = nextId++
    items = [...items, { id, message, type }]
    notify()
    setTimeout(() => {
      items = items.filter((t) => t.id !== id)
      notify()
    }, 4000)
  },
  success(msg: string) { this.show(msg, 'success') },
  error(msg: string) { this.show(msg, 'error') },
  info(msg: string) { this.show(msg, 'info') },
}

/**
 * <ToastHost /> 挂在 App 根处一次，渲染所有当前的 toast。
 * 全局 Portal 到 document.body。
 */
export function ToastHost() {
  const [list, setList] = useState<ToastItem[]>(items)
  useEffect(() => {
    subscribers.add(setList)
    return () => {
      subscribers.delete(setList)
    }
  }, [])

  if (list.length === 0) return null
  return createPortal(
    <div
      style={{
        position: 'fixed',
        bottom: 28,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column-reverse',
        gap: 10,
        pointerEvents: 'none',
      }}
    >
      {list.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </div>,
    document.body,
  )
}

function ToastCard({ item }: { item: ToastItem }) {
  const accent = {
    success: 'var(--green)',
    error: 'var(--pink)',
    info: 'var(--blue)',
  }[item.type]
  return (
    <div
      className="animate-slide-up"
      style={{
        background: 'var(--bg-elev)',
        borderRadius: 14,
        padding: '12px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
        borderLeft: `3px solid ${accent}`,
        minWidth: 220,
        maxWidth: 400,
        pointerEvents: 'auto',
      }}
    >
      <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: 'var(--label)' }}>
        {item.message}
      </span>
    </div>
  )
}

// ─────────────── 兼容旧 hook API ───────────────
//
// 之前所有用 useToast() 的组件签名是 { show, ToastEl }，迁移期保留兼容性。
// 新组件直接 `import { toast }` 用全局 API；ToastEl 返回 null（host 在 App 根处）。
export function useToast() {
  return {
    show: (message: string, type: ToastType = 'info') => toast.show(message, type),
    ToastEl: null,
  }
}
