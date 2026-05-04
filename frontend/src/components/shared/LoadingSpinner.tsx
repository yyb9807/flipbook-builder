import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../../i18n'

interface Props {
  size?: 'sm' | 'md' | 'lg'
  text?: string
  overlay?: boolean
  steps?: string[]
  currentStep?: number
  currentPct?: number
  /** 提供取消回调时，overlay 模式下方会出现「取消」按钮。 */
  onCancel?: () => void
}

function fmt(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function LoadingSpinner({ size = 'md', text, overlay = false, steps, currentStep = 0, currentPct = 0, onCancel }: Props) {
  const { t } = useI18n()
  // 记录每个步骤的耗时
  const startRef = useRef<number>(Date.now())
  const stepStartRef = useRef<number>(Date.now())
  const lastStepRef = useRef<number>(currentStep)
  const [stepDurations, setStepDurations] = useState<number[]>([])
  const [tick, setTick] = useState(0)

  // 步骤切换时，记录上一步耗时
  useEffect(() => {
    if (currentStep !== lastStepRef.current) {
      const elapsed = Date.now() - stepStartRef.current
      setStepDurations((prev) => {
        const next = [...prev]
        next[lastStepRef.current] = elapsed
        return next
      })
      stepStartRef.current = Date.now()
      lastStepRef.current = currentStep
    }
  }, [currentStep])

  // 实时刷新当前步骤的计时
  useEffect(() => {
    if (!overlay || !steps) return
    const id = setInterval(() => setTick((t) => t + 1), 200)
    return () => clearInterval(id)
  }, [overlay, steps])

  if (overlay && steps) {
    const totalElapsed = Date.now() - startRef.current
    void tick // trigger rerender

    // Portal 到 body：避免被 animate-page-in / backdrop-filter 等祖先困住，
    // 否则 position:fixed 会相对祖先定位而非视口
    return createPortal(
      <div
        className="animate-fade-in"
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.35)',
          backdropFilter: 'saturate(180%) blur(18px)',
          WebkitBackdropFilter: 'saturate(180%) blur(18px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
        }}
      >
        <div
          style={{
            background: 'var(--bg-elev)',
            borderRadius: 22,
            padding: '28px 32px',
            width: 440,
            boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
          }}
        >
          <h3 style={{ fontWeight: 700, fontSize: 22, margin: '0 0 4px', letterSpacing: '-0.025em' }}>
            {t('spinner.creating')}
          </h3>
          <p style={{ color: 'var(--label-secondary)', fontSize: 14, margin: '0 0 22px' }}>
            {t('spinner.wait')}
          </p>

          <div style={{ marginBottom: 20 }}>
            {steps.map((s, i) => {
              const done = i < currentStep
              const active = i === currentStep
              // 步骤耗时显示
              let timeText: string | null = null
              if (done) {
                const d = stepDurations[i]
                if (d != null) timeText = fmt(d)
              } else if (active) {
                timeText = fmt(Date.now() - stepStartRef.current)
              }
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '7px 0',
                    fontSize: 14.5,
                    fontWeight: active ? 600 : 500,
                    color: active ? 'var(--label)' : done ? 'var(--label-secondary)' : 'var(--label-tertiary)',
                    transition: 'color 0.3s, font-weight 0.3s',
                  }}
                >
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: done ? 'var(--green)' : active ? 'var(--blue)' : 'var(--gray-5)',
                      color: done || active ? 'white' : 'var(--label-secondary)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 10,
                      fontWeight: 600,
                      flexShrink: 0,
                      animation: active ? 'spin 1s linear infinite' : 'none',
                      fontFamily: 'var(--mono)',
                      transition: 'background 0.3s',
                    }}
                  >
                    {done ? '✓' : i + 1}
                  </span>
                  <span style={{ flex: 1 }}>{s}</span>
                  {timeText && (
                    <span
                      style={{
                        fontFamily: 'var(--mono)',
                        fontSize: 11,
                        color: active ? 'var(--blue)' : 'var(--label-tertiary)',
                        fontWeight: 500,
                      }}
                    >
                      {timeText}
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          <div style={{ height: 5, background: 'var(--gray-5)', borderRadius: 99, overflow: 'hidden', marginBottom: 6 }}>
            <div
              style={{
                height: '100%',
                width: `${currentPct}%`,
                background: 'var(--blue)',
                borderRadius: 99,
                transition: 'width 0.5s ease',
              }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--label-secondary)' }}>
            <span>{t('spinner.totalElapsed', { pct: Math.round(currentPct), time: fmt(totalElapsed) })}</span>
            <span>{steps[currentStep]}…</span>
          </div>

          {onCancel && (
            <button
              onClick={onCancel}
              style={{
                marginTop: 18,
                width: '100%',
                padding: '9px 14px',
                background: 'var(--gray-5)',
                border: 'none',
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--label-secondary)',
                cursor: 'pointer',
                fontFamily: 'var(--sans)',
                transition: 'background 0.15s, color 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,59,48,0.1)'
                e.currentTarget.style.color = 'var(--red, #FF3B30)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--gray-5)'
                e.currentTarget.style.color = 'var(--label-secondary)'
              }}
            >
              {t('spinner.cancel')}
            </button>
          )}
        </div>
      </div>,
      document.body,
    )
  }

  const sz = { sm: 16, md: 32, lg: 48 }[size]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div
        style={{
          width: sz,
          height: sz,
          borderRadius: '50%',
          border: '2px solid var(--gray-4)',
          borderTopColor: 'var(--blue)',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      {text && <p style={{ fontSize: 14, color: 'var(--label-secondary)', margin: 0 }}>{text}</p>}
    </div>
  )
}
