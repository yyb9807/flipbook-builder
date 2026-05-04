import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useProjectStore } from '../../store/projectStore'
import { api } from '../../api/client'
import { useToast } from '../shared/Toast'
import { Icon } from '../shared/Icon'
import { useI18n } from '../../i18n'

/**
 * 顶栏右侧的项目操作菜单：分享、导出 JSON、导出 HTML。
 * 只在有项目时显示。
 */
export function ProjectActions() {
  const { t } = useI18n()
  const project = useProjectStore((s) => s.project)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const { show: showToast, ToastEl } = useToast()

  // 用 ref 拿到按钮位置，portal 出去后下拉菜单基于 viewport 坐标定位
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)

  useEffect(() => {
    if (!open) return
    function update() {
      const r = btnRef.current?.getBoundingClientRect()
      if (!r) return
      setPos({ top: r.bottom + 6, right: window.innerWidth - r.right })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  if (!project) return null

  function close() {
    setOpen(false)
  }

  async function copyShareLink() {
    const url = `${window.location.origin}/v/${project!.project_id}`
    try {
      await navigator.clipboard.writeText(url)
      showToast(t('builder.actions.linkCopied'), 'success')
    } catch {
      // 浏览器不允许 clipboard 时降级 prompt
      window.prompt(t('builder.actions.copyPrompt'), url)
    }
    close()
  }

  async function exportJson() {
    if (busy) return
    setBusy(true)
    try {
      const data = await api.exportProjectJson(project!.project_id)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      triggerDownload(blob, `${safeFileName(project!.name)}.json`)
      showToast(t('builder.actions.jsonExported'), 'success')
    } catch (e) {
      showToast(t('builder.actions.exportFailed', { error: (e as Error).message }), 'error')
    } finally {
      setBusy(false)
      close()
    }
  }

  async function exportZip() {
    if (busy) return
    setBusy(true)
    try {
      const blob = await api.exportProjectZip(project!.project_id)
      triggerDownload(blob, `${safeFileName(project!.name)}.zip`)
      showToast(t('builder.actions.zipExported'), 'success')
    } catch (e) {
      showToast(t('builder.actions.exportFailed', { error: (e as Error).message }), 'error')
    } finally {
      setBusy(false)
      close()
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        title={t('builder.actions.shareTooltip')}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '5px 12px',
          background: 'var(--gray-6)',
          border: 'none',
          borderRadius: 999,
          fontSize: 12.5,
          fontWeight: 500,
          color: 'var(--label-secondary)',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          fontFamily: 'var(--sans)',
        }}
      >
        <Icon name="share" size={12} stroke={2} />
        {t('builder.actions.share')}
      </button>

      {open && pos && createPortal(
        <>
          {/* 点击外部关闭。portal 到 body，避免被任何祖先的 transform/backdrop-filter 困住。 */}
          <div
            onClick={close}
            style={{ position: 'fixed', inset: 0, zIndex: 200 }}
          />
          <div
            style={{
              position: 'fixed',
              top: pos.top,
              right: pos.right,
              minWidth: 240,
              background: 'var(--bg-elev)',
              borderRadius: 12,
              boxShadow: '0 12px 36px rgba(0,0,0,0.16), 0 2px 8px rgba(0,0,0,0.06)',
              padding: 6,
              zIndex: 201,
              animation: 'popIn 0.14s ease',
            }}
          >
            <MenuItem
              icon={<Icon name="link" size={14} stroke={2} />}
              label={t('builder.actions.copyLink')}
              hint={t('builder.actions.copyLinkHint')}
              onClick={copyShareLink}
            />
            <MenuItem
              icon={<Icon name="json" size={14} stroke={2} />}
              label={t('builder.actions.exportJson')}
              hint={t('builder.actions.exportJsonHint')}
              onClick={exportJson}
              disabled={busy}
            />
            <MenuItem
              icon={<Icon name="zip" size={14} stroke={2} />}
              label={t('builder.actions.exportZip')}
              hint={t('builder.actions.exportZipHint')}
              onClick={exportZip}
              disabled={busy}
            />
          </div>
        </>,
        document.body,
      )}
      {ToastEl}
    </div>
  )
}

function MenuItem({
  icon,
  label,
  hint,
  onClick,
  disabled,
}: {
  icon: React.ReactNode
  label: string
  hint?: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        background: 'transparent',
        border: 'none',
        borderRadius: 8,
        cursor: disabled ? 'wait' : 'pointer',
        textAlign: 'left',
        opacity: disabled ? 0.5 : 1,
        transition: 'background 0.12s',
        fontFamily: 'var(--sans)',
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = 'var(--gray-6)'
      }}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: 7,
          background: 'var(--gray-6)',
          color: 'var(--label-secondary)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--label)' }}>{label}</span>
        {hint && (
          <span style={{ fontSize: 11.5, color: 'var(--label-tertiary)', marginTop: 1 }}>
            {hint}
          </span>
        )}
      </span>
    </button>
  )
}

function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'flipbook'
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

