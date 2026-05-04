import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useSettingsStore } from '../../store/settingsStore'
import { Icon } from '../shared/Icon'
import { ImageUploadField } from './ImageUploadField'
import { HeroDecor } from './HeroDecor'
import { Footer } from '../shared/Footer'
import { useI18n } from '../../i18n'

interface Props {
  onFile: (file: File, keywords?: string) => void
  onText: (text: string) => void
  loading: boolean
  /** 由 HomePage 注入的「我的项目」列表 */
  projectList?: ReactNode
}

type Tab = 'image' | 'text'

/**
 * 首页主区域：左 Hero 卡片（标题 + 创作表单）+ 右浮动装饰 + 下方项目列表 + 底部 features。
 *
 * 创作表单逻辑被拆到 <ImageUploadField>（图片 tab）和直接 textarea（文字 tab）。
 * 装饰卡片在 <HeroDecor>。本组件只负责 tab 切换 + CTA 协调。
 */
export function UploadZone({ onFile, onText, loading, projectList }: Props) {
  const [tab, setTab] = useState<Tab>('image')
  const [file, setFile] = useState<File | null>(null)
  const [text, setText] = useState('')
  const [keywords, setKeywords] = useState('')

  const llmApiKey = useSettingsStore((s) => s.llmApiKey)
  const needsKey = !llmApiKey || llmApiKey.trim().length < 8
  const canSubmit = tab === 'image' ? !!file : !!text.trim()

  function submit() {
    if (loading || !canSubmit) return
    if (tab === 'text') onText(text.trim())
    else if (file) onFile(file, keywords.trim() || undefined)
  }

  return (
    <div className="home-page animate-page-in" style={{ flex: 1, overflow: 'auto' }}>
      <div className="home-top-row">
        <section className="create-card animate-slide-up" style={{ animationDelay: '0.05s' }}>
          <CardHeader />

          <TabToggle current={tab} onChange={setTab} />

          {tab === 'image' ? (
            <ImageUploadField
              file={file}
              onFile={setFile}
              keywords={keywords}
              onKeywords={setKeywords}
            />
          ) : (
            <TextField value={text} onChange={setText} />
          )}

          <SubmitButton needsKey={needsKey} loading={loading} disabled={!canSubmit} onClick={submit} />
        </section>

        <HeroDecor />
      </div>

      {projectList}
      <Footer />
    </div>
  )
}

// ─────────────── 内部小组件 ───────────────

function CardHeader() {
  const { t } = useI18n()
  return (
    <div className="create-card-header">
      <span className="ic">
        <Icon name="spark" size={18} />
      </span>
      <div>
        <h2>{t('home.create.title')}</h2>
        <p>{t('home.create.subtitle')}</p>
      </div>
    </div>
  )
}

function TabToggle({ current, onChange }: { current: Tab; onChange: (t: Tab) => void }) {
  const { t: tr } = useI18n()
  return (
    <div
      style={{
        display: 'flex',
        background: 'var(--gray-5)',
        borderRadius: 9,
        padding: 2,
        marginBottom: 14,
      }}
    >
      {(['image', 'text'] as const).map((tab) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          style={{
            flex: 1,
            background: current === tab ? 'white' : 'transparent',
            border: 'none',
            padding: '8px 14px',
            borderRadius: 7,
            fontSize: 13,
            fontWeight: 600,
            color: current === tab ? 'var(--label)' : 'var(--label-secondary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            boxShadow: current === tab ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
            transition: 'background 0.15s',
            fontFamily: 'var(--sans)',
          }}
        >
          <Icon name={tab === 'image' ? 'image' : 'pen'} size={12} stroke={1.8} />
          {tab === 'image' ? tr('home.tab.image') : tr('home.tab.text')}
        </button>
      ))}
    </div>
  )
}

function TextField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useI18n()
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={t('home.text.placeholder')}
      style={{
        width: '100%',
        minHeight: 120,
        padding: '14px 16px',
        background: 'var(--gray-6)',
        border: 'none',
        borderRadius: 12,
        fontSize: 15,
        color: 'var(--label)',
        outline: 'none',
        resize: 'vertical',
        fontFamily: 'var(--sans)',
        lineHeight: 1.45,
        transition: 'background 0.15s, box-shadow 0.15s',
        boxSizing: 'border-box',
      }}
      onFocus={(e) => {
        e.target.style.background = 'white'
        e.target.style.boxShadow = '0 0 0 3px rgba(0,122,255,0.25)'
      }}
      onBlur={(e) => {
        e.target.style.background = 'var(--gray-6)'
        e.target.style.boxShadow = 'none'
      }}
    />
  )
}

function SubmitButton({
  needsKey,
  loading,
  disabled,
  onClick,
}: {
  needsKey: boolean
  loading: boolean
  disabled: boolean
  onClick: () => void
}) {
  const { t } = useI18n()
  return (
    <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end' }}>
      {needsKey ? (
        <Link
          to="/settings"
          className="btn btn-lg btn-pink"
          style={{ minWidth: 200, justifyContent: 'center', textDecoration: 'none' }}
        >
          <Icon name="gear" size={14} stroke={2} />
          {t('home.cta.configKey')}
          <Icon name="arrow-right" size={14} stroke={2} />
        </Link>
      ) : (
        <button
          onClick={onClick}
          disabled={loading || disabled}
          className="btn btn-lg btn-pink"
          style={{ opacity: loading ? 0.7 : 1, minWidth: 160 }}
        >
          {loading ? (
            <>
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  border: '2px solid rgba(255,255,255,0.4)',
                  borderTopColor: 'white',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
              {t('home.cta.analyzing')}
            </>
          ) : (
            <>
              {t('home.cta.start')}
              <Icon name="arrow-right" size={16} />
            </>
          )}
        </button>
      )}
    </div>
  )
}
