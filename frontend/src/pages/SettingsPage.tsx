import { useState } from 'react'
import { useSettingsStore } from '../store/settingsStore'
import { api } from '../api/client'
import type { TestConfigResult } from '../types/api'
import type { LLMProvider } from '../utils/llmProviders'
import { findProviderByBaseUrl } from '../utils/llmProviders'
import { Section } from '../components/settings/Section'
import { SettingField } from '../components/settings/SettingField'
import { ImgModelPresets } from '../components/settings/ImgModelPresets'
import { ChatModelPresets } from '../components/settings/ChatModelPresets'
import { ProviderPicker } from '../components/settings/ProviderPicker'
import { TestResult } from '../components/settings/TestResult'
import { SettingsNav } from '../components/settings/SettingsNav'
import { ActionBar } from '../components/settings/ActionBar'
import { Footer } from '../components/shared/Footer'
import { QuickStartHint } from '../components/settings/QuickStartHint'
import { Collapse } from '../components/settings/Collapse'
import { useI18n } from '../i18n'

/** 把 API Key 显示成 "sk-an…X4n2 (108)" 这种形式，方便用户核对粘贴是否完整。 */
function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 12) return `${key.slice(0, 4)}… (${key.length})`
  return `${key.slice(0, 6)}…${key.slice(-4)} (${key.length})`
}

/** 从 URL 抽取主机名作为副标题（找不到 provider 时降级用）。 */
function hostFromUrl(url: string, fallback: string): string {
  try {
    return new URL(url).hostname.replace(/^api\./, '')
  } catch {
    return url || fallback
  }
}

export function SettingsPage() {
  const settings = useSettingsStore()
  const { t } = useI18n()
  const [form, setForm] = useState({
    llmBaseUrl: settings.llmBaseUrl,
    llmApiKey: settings.llmApiKey,
    llmModel: settings.llmModel,
    imgGenBaseUrl: settings.imgGenBaseUrl,
    imgGenApiKey: settings.imgGenApiKey,
    imgGenModel: settings.imgGenModel,
  })
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestConfigResult | null>(null)
  const [testError, setTestError] = useState<string | null>(null)

  const dirty =
    form.llmBaseUrl !== settings.llmBaseUrl ||
    form.llmApiKey !== settings.llmApiKey ||
    form.llmModel !== settings.llmModel ||
    form.imgGenBaseUrl !== settings.imgGenBaseUrl ||
    form.imgGenApiKey !== settings.imgGenApiKey ||
    form.imgGenModel !== settings.imgGenModel

  function update<K extends keyof typeof form>(field: K, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  /** 选 LLM 厂商：填 base URL + 自动选这家的推荐 model（如果当前 model 不在该家清单内）。 */
  function pickLlmProvider(p: LLMProvider) {
    setForm((f) => {
      const updates: Partial<typeof f> = { llmBaseUrl: p.baseUrl }
      const currentInList = p.chatModels.some((m) => m.id === f.llmModel)
      if (!currentInList && p.chatModels.length > 0) {
        const recommended = p.chatModels.find((m) => m.recommended) ?? p.chatModels[0]
        updates.llmModel = recommended.id
      }
      return { ...f, ...updates }
    })
  }

  /** 选图片厂商：同上，但是图片模型清单（部分 provider 没有 imageModels 就只切 base URL）。 */
  function pickImgProvider(p: LLMProvider) {
    setForm((f) => {
      const updates: Partial<typeof f> = { imgGenBaseUrl: p.baseUrl }
      if (p.imageModels && p.imageModels.length > 0) {
        const inList = p.imageModels.some((m) => m.id === f.imgGenModel)
        if (!inList) {
          const recommended = p.imageModels.find((m) => m.recommended) ?? p.imageModels[0]
          updates.imgGenModel = recommended.id
        }
      }
      return { ...f, ...updates }
    })
  }

  function handleSave() {
    settings.updateSettings(form)
    setSaved(true)
    setTestResult(null)
    setTestError(null)
    setTimeout(() => setSaved(false), 2500)
  }

  async function handleTest() {
    if (testing) return
    settings.updateSettings(form)
    setTesting(true)
    setTestResult(null)
    setTestError(null)
    try {
      setTestResult(await api.testConfig())
    } catch (e) {
      setTestError((e as Error).message || t('settings.test.unknownError'))
    } finally {
      setTesting(false)
    }
  }

  // 副标题 / 状态：基于已保存的 settings（不是 form），让用户看到"当前生效"的配置
  const llmProvider = findProviderByBaseUrl(settings.llmBaseUrl)
  const imgProvider = findProviderByBaseUrl(settings.imgGenBaseUrl)
  const notConfigured = t('settings.subtitle.notConfigured')
  const noModel = t('settings.subtitle.noModel')
  const llmProviderName = llmProvider ? t(`provider.${llmProvider.id}` as 'provider.custom') : hostFromUrl(settings.llmBaseUrl, notConfigured)
  const imgProviderName = imgProvider ? t(`provider.${imgProvider.id}` as 'provider.custom') : hostFromUrl(settings.imgGenBaseUrl, notConfigured)
  const llmSubtitle = `${llmProviderName} · ${settings.llmModel || noModel}`
  const imgSubtitle = `${imgProviderName} · ${settings.imgGenModel || noModel}`

  const hasLlmKey = !!settings.llmApiKey && settings.llmApiKey.length >= 8
  const hasImgKey = !!settings.imgGenApiKey && settings.imgGenApiKey.length >= 8

  // 自定义 provider 时自动展开"高级 Base URL"，避免用户找不到地方填
  const llmIsCustom = !findProviderByBaseUrl(form.llmBaseUrl)
  const imgIsCustom = !findProviderByBaseUrl(form.imgGenBaseUrl)

  return (
    <div
      style={{
        width: '100%',
        height: '100vh',
        background: 'var(--bg)',
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <SettingsNav />

      <div
        style={{
          flex: 1,
          maxWidth: 680,
          width: '100%',
          margin: '0 auto',
          padding: '24px 24px 8px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <QuickStartHint hasLlmKey={hasLlmKey} hasImgKey={hasImgKey} />

        {/* ── 文本 LLM ── */}
        <Section
          title={t('settings.section.llm')}
          subtitle={llmSubtitle}
          tone="blue"
          status={hasLlmKey ? 'ok' : 'missing'}
        >
          <FieldGroup label={t('settings.field.provider')}>
            <ProviderPicker currentBaseUrl={form.llmBaseUrl} onPick={pickLlmProvider} />
          </FieldGroup>

          <SettingField
            label={t('settings.field.apiKey')}
            type="password"
            value={form.llmApiKey}
            onChange={(v) => update('llmApiKey', v)}
            placeholder={
              llmProvider?.id === 'anthropic'
                ? t('settings.placeholder.keyAnthropic')
                : t('settings.placeholder.keyGeneric')
            }
            labelHint={
              settings.llmApiKey ? t('settings.field.savedKey', { value: maskKey(settings.llmApiKey) }) : undefined
            }
          />

          <SettingField
            label={t('settings.field.model')}
            value={form.llmModel}
            onChange={(v) => update('llmModel', v)}
            placeholder={t('settings.placeholder.modelLlm')}
            below={
              <div style={{ marginTop: 8 }}>
                <ChatModelPresets
                  baseUrl={form.llmBaseUrl}
                  current={form.llmModel}
                  onPick={(id) => update('llmModel', id)}
                />
              </div>
            }
          />

          <Collapse label={t('settings.field.advancedBaseUrl')} defaultOpen={llmIsCustom}>
            <SettingField
              label={t('settings.field.baseUrl')}
              value={form.llmBaseUrl}
              onChange={(v) => update('llmBaseUrl', v)}
              placeholder="https://api.anthropic.com"
            />
          </Collapse>
        </Section>

        {/* ── 图片生成 ── */}
        <Section
          title={t('settings.section.imggen')}
          subtitle={imgSubtitle}
          tone="pink"
          status={hasImgKey ? 'ok' : 'missing'}
        >
          <FieldGroup label={t('settings.field.provider')}>
            <ProviderPicker currentBaseUrl={form.imgGenBaseUrl} onPick={pickImgProvider} />
          </FieldGroup>

          <SettingField
            label={t('settings.field.apiKey')}
            type="password"
            value={form.imgGenApiKey}
            onChange={(v) => update('imgGenApiKey', v)}
            placeholder={t('settings.placeholder.keyGeneric')}
            labelHint={
              settings.imgGenApiKey
                ? t('settings.field.savedKey', { value: maskKey(settings.imgGenApiKey) })
                : undefined
            }
          />

          <SettingField
            label={t('settings.field.model')}
            value={form.imgGenModel}
            onChange={(v) => update('imgGenModel', v)}
            placeholder={t('settings.placeholder.modelImg')}
            below={
              <div style={{ marginTop: 8 }}>
                <ImgModelPresets
                  baseUrl={form.imgGenBaseUrl}
                  current={form.imgGenModel}
                  onPick={(id) => update('imgGenModel', id)}
                />
              </div>
            }
          />

          <Collapse label={t('settings.field.advancedBaseUrl')} defaultOpen={imgIsCustom}>
            <SettingField
              label={t('settings.field.baseUrl')}
              value={form.imgGenBaseUrl}
              onChange={(v) => update('imgGenBaseUrl', v)}
              placeholder="https://api.openai.com/v1"
            />
          </Collapse>
        </Section>

        {/* 测试结果（仅有结果或错误时占位） */}
        <TestResult result={testResult} error={testError} />

        <ActionBar
          saved={saved}
          testing={testing}
          dirty={dirty}
          onSave={handleSave}
          onTest={handleTest}
        />

        <Footer />
      </div>
    </div>
  )
}

/**
 * 与 SettingField 一致排版的非 input 字段组（供 ProviderPicker 用）。
 * 不直接复用 SettingField 是因为它强制 input；这里只想要 label + 自由内容。
 */
function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label
        style={{
          display: 'block',
          fontSize: 12.5,
          fontWeight: 600,
          color: 'var(--label-secondary)',
          letterSpacing: '0.01em',
          marginBottom: 6,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  )
}
