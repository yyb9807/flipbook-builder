import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../../i18n'

export interface ConfirmOptions {
  title: string
  message?: string
  confirmText?: string
  cancelText?: string
  /** 'danger' 显示红色 CTA（删除场景）；'normal' 蓝色（默认）。 */
  tone?: 'danger' | 'normal'
}

interface PendingDialog extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

// ─────────────── 全局 Confirm 单例 ───────────────
//
// 类似 Toast：之前 4 处 useConfirm() 各自挂 portal。现在合并：
//   - <ConfirmHost /> 挂在 App 根处
//   - import { confirm } from '...' 直接调用，返回 Promise<boolean>
let pending: PendingDialog | null = null
const subscribers = new Set<(p: PendingDialog | null) => void>()

function notify() {
  for (const sub of subscribers) sub(pending)
}

/** 命令式 confirm，返回 Promise<boolean>。 */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    pending = { ...opts, resolve }
    notify()
  })
}

function close(ok: boolean) {
  if (!pending) return
  pending.resolve(ok)
  pending = null
  notify()
}

/** <ConfirmHost /> 挂在 App 根处一次。 */
export function ConfirmHost() {
  const { t } = useI18n()
  const [current, setCurrent] = useState<PendingDialog | null>(pending)
  const cancelBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    subscribers.add(setCurrent)
    return () => {
      subscribers.delete(setCurrent)
    }
  }, [])

  useEffect(() => {
    if (!current) return
    cancelBtnRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close(false)
      else if (e.key === 'Enter') close(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current])

  if (!current) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      onClick={() => close(false)}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        backdropFilter: 'saturate(180%) blur(12px)',
        WebkitBackdropFilter: 'saturate(180%) blur(12px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
        animation: 'fadeIn 0.15s ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-elev)',
          borderRadius: 18,
          padding: '24px 28px',
          width: 380,
          maxWidth: 'calc(100vw - 32px)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
          animation: 'popIn 0.18s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        <h3
          id="confirm-title"
          style={{
            margin: '0 0 8px',
            fontWeight: 700,
            fontSize: 17,
            letterSpacing: '-0.02em',
            color: 'var(--label)',
          }}
        >
          {current.title}
        </h3>
        {current.message && (
          <p
            style={{
              margin: '0 0 18px',
              fontSize: 14,
              lineHeight: 1.5,
              color: 'var(--label-secondary)',
            }}
          >
            {current.message}
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: current.message ? 0 : 16 }}>
          <button
            ref={cancelBtnRef}
            onClick={() => close(false)}
            style={{
              flex: 1,
              padding: '10px 16px',
              background: 'var(--gray-5)',
              border: 'none',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--label)',
              cursor: 'pointer',
              fontFamily: 'var(--sans)',
            }}
          >
            {current.cancelText ?? t('common.cancel')}
          </button>
          <button
            onClick={() => close(true)}
            style={{
              flex: 1,
              padding: '10px 16px',
              background: current.tone === 'danger' ? 'var(--red, #FF3B30)' : 'var(--blue, #007AFF)',
              border: 'none',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              color: 'white',
              cursor: 'pointer',
              fontFamily: 'var(--sans)',
            }}
          >
            {current.confirmText ?? t('common.confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ─────────────── 兼容旧 hook API ───────────────
export function useConfirm() {
  return {
    confirm,
    ConfirmEl: null,
  }
}
