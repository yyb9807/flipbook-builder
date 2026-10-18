import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useProjectStore } from '../../store/projectStore'
import { useToast } from '../shared/Toast'
import { Icon } from '../shared/Icon'
import { useCopy } from '../../i18n/workspace'
import { useNodeDraftStore } from '../../store/nodeDraftStore'

export function ProjectActions() {
  const c = useCopy()
  const project = useProjectStore((s) => s.project)
  const origin = useProjectStore((s) => s.origin)
  const hasDrafts = useNodeDraftStore((s) => Object.keys(s.drafts[project?.project_id ?? ''] ?? {}).length > 0)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: 60, right: 18 })
  const { show, ToastEl } = useToast()
  function close() { setOpen(false); trigger.current?.focus() }
  useEffect(() => {
    if (!open) return
    function update() { const r = trigger.current?.getBoundingClientRect(); if (r) setPosition({ top: r.bottom + 8, right: Math.max(12, window.innerWidth - r.right) }) }
    update()
    const frame = requestAnimationFrame(() => menu.current?.querySelector<HTMLButtonElement>('button')?.focus())
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus() }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
        if (!items.length) return
        event.preventDefault()
        const index = items.indexOf(document.activeElement as HTMLButtonElement)
        items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus()
      }
    }
    window.addEventListener('resize', update)
    window.addEventListener('keydown', key)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', update); window.removeEventListener('keydown', key) }
  }, [open])
  if (!project) return null
  async function share() {
    const url = window.location.origin + '/v/' + project!.project_id
    try { await navigator.clipboard.writeText(url); show(c('当前实例链接已复制。访问者需能连接此实例。', 'Instance link copied. Readers need access to this instance.'), 'success') }
    catch { window.prompt(c('复制此链接：', 'Copy this link:'), url) }
    close()
  }
  async function exportProject(kind: 'json' | 'zip') {
    if (busy || !project) return
    setBusy(true)
    try {
      const { publicationSnapshot, createOfflineZip } = await import('../../utils/offlineExport')
      const blob = kind === 'zip' ? await createOfflineZip(project) : new Blob([JSON.stringify(publicationSnapshot(project), null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = (project.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'flipbook') + '.' + kind
      document.body.appendChild(anchor); anchor.click(); anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      show(c('作品已导出', 'Project exported'), 'success')
    } catch (e) { show(c('导出失败：', 'Export failed: ') + (e as Error).message, 'error') }
    finally { setBusy(false); close() }
  }
  return <div>
    <button className="topbar-pill" ref={trigger} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}><Icon name="share" />{busy ? c('打包中…', 'Preparing…') : c('导出与分享', 'Export & share')}</button>
    {open && createPortal(<>
      <div className="menu-backdrop" onClick={close} />
      <div role="menu" aria-label={c('作品导出', 'Export project')} ref={menu} className="project-menu" style={position}>
        {origin === 'server' && <button role="menuitem" onClick={() => void share()}><Icon name="link" /><span><strong>{c('复制当前实例链接', 'Copy instance link')}</strong><small>{c('需要实例在线，非独立发布', 'Requires this instance to stay online')}</small></span></button>}
        {hasDrafts && <p className="menu-draft-note">{c('有未保存的页面草稿。请先在内容面板保存，再导出。', 'Save page drafts in the content panel before exporting.')}</p>}
        <button role="menuitem" disabled={busy || hasDrafts} onClick={() => void exportProject('zip')}><Icon name="zip" /><span><strong>{c('导出离线 ZIP', 'Export offline ZIP')}</strong><small>{c('包含图片与播放器，解压即可阅读', 'Includes images and player. Open after extraction.')}</small></span></button>
        <button role="menuitem" disabled={busy || hasDrafts} onClick={() => void exportProject('json')}><Icon name="json" /><span><strong>{c('导出 JSON', 'Export JSON')}</strong><small>{c('作品结构与内容，不包含密钥', 'Project data, without credentials')}</small></span></button>
      </div>
    </>, document.body)}{ToastEl}
  </div>
}
