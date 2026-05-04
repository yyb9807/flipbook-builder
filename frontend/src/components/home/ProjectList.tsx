import { useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { api } from '../../api/client'
import { useProjectStore } from '../../store/projectStore'
import { useToast } from '../shared/Toast'
import { useConfirm } from '../shared/ConfirmDialog'
import { Icon } from '../shared/Icon'
import type { Project } from '../../types'
import type { ProjectListItem as Item } from '../../types/api'
import { useI18n } from '../../i18n'
import type { Locale } from '../../i18n'

function formatTime(iso: string | null, locale: Locale, t: (k: 'home.time.justNow' | 'home.time.minutesAgo' | 'home.time.hoursAgo' | 'home.time.daysAgo', vars?: Record<string, string | number>) => string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diff = (now.getTime() - d.getTime()) / 1000
  if (diff < 60) return t('home.time.justNow')
  if (diff < 3600) return t('home.time.minutesAgo', { n: Math.floor(diff / 60) })
  if (diff < 86400) return t('home.time.hoursAgo', { n: Math.floor(diff / 3600) })
  if (diff < 86400 * 7) return t('home.time.daysAgo', { n: Math.floor(diff / 86400) })
  return d.toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' })
}

export function ProjectList() {
  const { t, locale } = useI18n()
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const setProject = useProjectStore((s) => s.setProject)
  const setActiveNode = useProjectStore((s) => s.setActiveNode)
  const navigateInto = useProjectStore((s) => s.navigateInto)
  const { show: showToast, ToastEl } = useToast()
  const { confirm, ConfirmEl } = useConfirm()

  useEffect(() => {
    let alive = true
    api
      .listProjects()
      .then((r) => {
        if (alive) setItems(r.projects)
      })
      .catch((e) => alive && setError((e as Error).message))
    return () => {
      alive = false
    }
  }, [])

  async function openProject(id: string) {
    try {
      const proj = (await api.getProject(id)) as Project
      setProject(proj)
      if (proj.root_node_id) {
        setActiveNode(proj.root_node_id)
        navigateInto(proj.root_node_id)
      }
    } catch (e) {
      showToast(t('home.projects.fetchFailed', { error: (e as Error).message }), 'error')
    }
  }

  async function deleteProject(id: string, name: string) {
    const ok = await confirm({
      title: t('home.projects.deleteTitle', { name }),
      message: t('home.projects.deleteMessage'),
      confirmText: t('home.projects.delete'),
      cancelText: t('common.cancel'),
      tone: 'danger',
    })
    if (!ok) return
    try {
      await api.deleteProject(id)
      setItems((cur) => cur?.filter((p) => p.project_id !== id) ?? null)
      showToast(t('home.projects.deleted', { name }), 'success')
    } catch (err) {
      showToast(t('home.projects.deleteFailed', { error: (err as Error).message }), 'error')
    }
  }

  function handleCardKey(e: KeyboardEvent<HTMLDivElement>, id: string) {
    if (e.key === 'Enter') {
      e.preventDefault()
      openProject(id)
    } else if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault() // 防止 Space 触发页面滚动
      openProject(id)
    }
  }

  if (error) {
    return (
      <section className="projects-section">
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--label-tertiary)', fontSize: 13 }}>
          {t('home.projects.loadFailed', { error })}
        </div>
      </section>
    )
  }

  if (items === null) {
    return (
      <section className="projects-section">
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--label-tertiary)', fontSize: 13 }}>
          {t('home.projects.loading')}
        </div>
      </section>
    )
  }

  return (
    <section className="projects-section animate-slide-up" style={{ animationDelay: '0.15s' }}>
      <div className="projects-section-head">
        <h3>{t('home.projects.title')}</h3>
        <span className="count">
          {items.length === 0 ? t('home.projects.noneShort') : t('home.projects.count', { n: items.length })}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="empty-projects">
          <strong>{t('home.projects.emptyTitle')}</strong>
          <span>{t('home.projects.emptyHint')}</span>
        </div>
      ) : (
        <div className="projects-grid">
          {items.map((p, i) => {
            const title = p.root_title || p.name
            return (
            <div
              key={p.project_id}
              role="button"
              tabIndex={0}
              aria-label={t('home.projects.openLabel', { name: title })}
              className="project-card animate-slide-up"
              style={{ animationDelay: `${0.05 + i * 0.04}s` }}
              onClick={() => openProject(p.project_id)}
              onKeyDown={(e) => handleCardKey(e, p.project_id)}
            >
              <div className="project-card-thumb">
                {p.thumbnail ? (
                  <img
                    src={p.thumbnail}
                    alt=""
                    onError={(e) => {
                      ;(e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                ) : (
                  <div className="project-card-thumb-empty">{t('home.projects.noCover')}</div>
                )}
                <button
                  type="button"
                  className="project-card-delete"
                  aria-label={t('home.projects.deleteLabel', { name: title })}
                  title={t('home.projects.delete')}
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteProject(p.project_id, title)
                  }}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <Icon name="trash" size={13} stroke={2} />
                </button>
              </div>
              <div className="project-card-meta">
                <div className="project-card-title">
                  {title}
                </div>
                <div className="project-card-sub">
                  <span>{t('home.projects.pages', { n: p.node_count })}</span>
                  <span>·</span>
                  <span>{formatTime(p.updated_at, locale, t)}</span>
                </div>
              </div>
            </div>
            )
          })}
        </div>
      )}
      {ConfirmEl}
      {ToastEl}
    </section>
  )
}
