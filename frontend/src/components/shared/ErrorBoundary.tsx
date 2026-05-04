import { Component, type ErrorInfo, type ReactNode } from 'react'
import { translate, useI18nStore } from '../../i18n'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  errorInfo: ErrorInfo | null
}

/**
 * 全局错误边界：捕获子树内未处理的渲染错误，避免白屏。
 * 显示一个友好的错误页 + 详情（开发环境）+ 重试按钮（reload）。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo)
    this.setState({ error, errorInfo })
  }

  render() {
    if (!this.state.error) return this.props.children

    const isDev = import.meta.env.DEV
    // class component 不能用 hook，直接读 store 当前值
    const locale = useI18nStore.getState().locale
    const t = (key: Parameters<typeof translate>[1], vars?: Parameters<typeof translate>[2]) =>
      translate(locale, key, vars)

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 32,
          background: 'var(--bg)',
          fontFamily: 'var(--sans)',
        }}
      >
        <div
          style={{
            maxWidth: 560,
            width: '100%',
            background: 'var(--bg-elev)',
            borderRadius: 18,
            padding: '32px 36px',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: 'rgba(255,59,48,0.12)',
              color: 'var(--red, #FF3B30)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 18,
            }}
          >
            <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>

          <h1
            style={{
              fontWeight: 700,
              fontSize: 22,
              letterSpacing: '-0.025em',
              margin: '0 0 6px',
              color: 'var(--label)',
            }}
          >
            {t('error.title')}
          </h1>
          <p style={{ color: 'var(--label-secondary)', fontSize: 14, margin: '0 0 20px', lineHeight: 1.5 }}>
            {t('error.body')}
          </p>

          {isDev && (
            <details
              style={{
                background: 'var(--gray-6)',
                borderRadius: 10,
                padding: '10px 12px',
                marginBottom: 18,
                fontSize: 12,
                fontFamily: 'var(--mono)',
              }}
            >
              <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--label-secondary)' }}>
                {t('error.detailsLabel')}
              </summary>
              <pre
                style={{
                  margin: '8px 0 0',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  color: 'var(--red, #FF3B30)',
                  fontSize: 11,
                  lineHeight: 1.5,
                }}
              >
                {this.state.error.toString()}
                {'\n\n'}
                {this.state.errorInfo?.componentStack}
              </pre>
            </details>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => window.location.reload()}
              className="btn btn-lg btn-pink"
              style={{ flex: 1, justifyContent: 'center' }}
            >
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5" />
              </svg>
              {t('error.refresh')}
            </button>
            <button
              onClick={() => {
                // 清空 localStorage 后刷新（兜底：项目数据损坏时）。
                // 此处刻意用原生 confirm —— 因为 React 已崩溃，自定义 Dialog 可能渲染不出。
                if (window.confirm(t('error.clearConfirm'))) {
                  localStorage.clear()
                  window.location.reload()
                }
              }}
              className="btn btn-lg"
              style={{ flex: 1, justifyContent: 'center', background: 'var(--gray-5)', color: 'var(--label)' }}
            >
              {t('error.clearCache')}
            </button>
          </div>
        </div>
      </div>
    )
  }
}
