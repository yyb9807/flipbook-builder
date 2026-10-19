import { useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { sameEndpoint, useSettingsStore, type ModelSettings } from '../store/settingsStore'
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
import type { TranslationKey } from '../i18n'
import { useCopy } from '../i18n/workspace'
import { Icon } from '../components/shared/Icon'
import '../components/settings/settings.css'

function readSettings(): ModelSettings {
  const s = useSettingsStore.getState()
  return {
    llmBaseUrl: s.llmBaseUrl, llmApiKey: s.llmApiKey, llmModel: s.llmModel,
    imgGenBaseUrl: s.imgGenBaseUrl, imgGenApiKey: s.imgGenApiKey, imgGenModel: s.imgGenModel,
    rememberKeys: s.rememberKeys,
  }
}

function hostFromUrl(url: string, fallback: string): string {
  try { return new URL(url).hostname } catch { return url || fallback }
}

export function SettingsPage() {
  const settings = useSettingsStore()
  const { t } = useI18n()
  const c = useCopy()
  const [form, setForm] = useState<ModelSettings>(readSettings)
  const [saved, setSaved] = useState(false)
  const [cleared, setCleared] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestConfigResult | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [llmUrlOpen, setLlmUrlOpen] = useState(!findProviderByBaseUrl(settings.llmBaseUrl))
  const [imgUrlOpen, setImgUrlOpen] = useState(!findProviderByBaseUrl(settings.imgGenBaseUrl))
  const testRevision = useRef(0)
  const dirty = (Object.keys(form) as Array<keyof ModelSettings>).some((key) => form[key] !== settings[key])

  function resetFeedback() {
    testRevision.current += 1
    setSaved(false)
    setCleared(false)
    setTestResult(null)
    setTestError(null)
  }

  function update<K extends keyof ModelSettings>(field: K, value: ModelSettings[K]) {
    resetFeedback()
    setForm((previous) => ({
      ...previous,
      [field]: value,
      ...(field === 'llmBaseUrl' && !sameEndpoint(String(value), previous.llmBaseUrl) ? { llmApiKey: '' } : {}),
      ...(field === 'imgGenBaseUrl' && !sameEndpoint(String(value), previous.imgGenBaseUrl) ? { imgGenApiKey: '' } : {}),
    }))
  }

  function pickProvider(provider: LLMProvider, kind: 'chat' | 'image') {
    resetFeedback()
    if (!provider.baseUrl) {
      if (kind === 'chat') setLlmUrlOpen(true)
      else setImgUrlOpen(true)
    }
    setForm((previous) => {
      const baseField = kind === 'chat' ? 'llmBaseUrl' : 'imgGenBaseUrl'
      const keyField = kind === 'chat' ? 'llmApiKey' : 'imgGenApiKey'
      const modelField = kind === 'chat' ? 'llmModel' : 'imgGenModel'
      const models = kind === 'chat' ? provider.chatModels : provider.imageModels ?? []
      const currentModel = models.find((model) => model.id === previous[modelField])
      return {
        ...previous,
        [baseField]: provider.baseUrl,
        [keyField]: sameEndpoint(previous[baseField], provider.baseUrl) ? previous[keyField] : '',
        [modelField]: currentModel ? previous[modelField] : (models.find((model) => model.recommended) ?? models[0])?.id ?? previous[modelField],
      }
    })
  }

  function handleSave() {
    settings.updateSettings(form)
    setSaved(true)
    setCleared(false)
  }

  function handleClear() {
    resetFeedback()
    settings.clearCredentials()
    setForm((previous) => ({ ...previous, llmApiKey: '', imgGenApiKey: '', rememberKeys: false }))
    setCleared(true)
  }

  async function handleTest() {
    if (testing) return
    const revision = ++testRevision.current
    setTesting(true)
    setTestResult(null)
    setTestError(null)
    try {
      const result = await api.testConfig(form)
      if (revision === testRevision.current) setTestResult(result)
    } catch (error) {
      if (revision === testRevision.current) setTestError((error as Error).message || t('settings.test.unknownError'))
    } finally {
      setTesting(false)
    }
  }

  const llmProvider = findProviderByBaseUrl(form.llmBaseUrl)
  const imgProvider = findProviderByBaseUrl(form.imgGenBaseUrl)
  const fallback = t('settings.subtitle.notConfigured')
  const providerName = (provider: LLMProvider | null, url: string) => provider
    ? t(`provider.${provider.id}` as TranslationKey) : hostFromUrl(url, fallback)
  const hasKeys = !!(form.llmApiKey || form.imgGenApiKey || settings.llmApiKey || settings.imgGenApiKey)

  return (
    <div className="settings-page">
      <SettingsNav />
      <main className="settings-content" id="main-content">
        <header className="settings-intro">
          <h1>{c('AI 服务设置', 'AI service settings')}</h1>
          <p>{t('settings.page.description')}</p>
        </header>
        <aside className="settings-workspace-note"><Icon name="pen" size={18} /><p>{c('手动创作、来源检索和引用关联无需模型。', 'Manual creation, source search and citations work without a model.')}<Link to="/">{c('返回创作', 'Back to creating')}<Icon name="arrow-right" /></Link></p></aside>
        <QuickStartHint hasLlmKey={!!form.llmApiKey.trim()} hasImgKey={!!form.imgGenApiKey.trim()} />

        <Section title={t('settings.section.llm')} subtitle={providerName(llmProvider, form.llmBaseUrl)} status={form.llmApiKey.trim() ? 'ok' : 'missing'}>
          <p className="settings-section-description">{t('settings.section.llmDescription')}</p>
          <FieldGroup label={t('settings.field.provider')}>
            <ProviderPicker currentBaseUrl={form.llmBaseUrl} onPick={(provider) => pickProvider(provider, 'chat')} />
          </FieldGroup>
          <SettingField label={t('settings.field.apiKey')} type="password" value={form.llmApiKey} onChange={(value) => update('llmApiKey', value)} placeholder={llmProvider?.id === 'anthropic' ? t('settings.placeholder.keyAnthropic') : t('settings.placeholder.keyGeneric')} />
          <SettingField label={t('settings.field.model')} value={form.llmModel} onChange={(value) => update('llmModel', value)} placeholder={t('settings.placeholder.modelLlm')} below={<ChatModelPresets baseUrl={form.llmBaseUrl} current={form.llmModel} onPick={(model) => update('llmModel', model)} />} />
          <Collapse label={t('settings.field.advancedBaseUrl')} open={llmUrlOpen} onOpenChange={setLlmUrlOpen}>
            <SettingField label={t('settings.field.baseUrl')} value={form.llmBaseUrl} onChange={(value) => update('llmBaseUrl', value)} placeholder="https://api.anthropic.com" />
          </Collapse>
        </Section>

        <Section title={t('settings.section.imggen')} subtitle={providerName(imgProvider, form.imgGenBaseUrl)} status={form.imgGenApiKey.trim() ? 'ok' : 'missing'}>
          <p className="settings-section-description">{t('settings.section.imgDescription')}</p>
          <FieldGroup label={t('settings.field.provider')}>
            <ProviderPicker kind="image" currentBaseUrl={form.imgGenBaseUrl} onPick={(provider) => pickProvider(provider, 'image')} />
          </FieldGroup>
          <SettingField label={t('settings.field.apiKey')} type="password" value={form.imgGenApiKey} onChange={(value) => update('imgGenApiKey', value)} placeholder={t('settings.placeholder.keyGeneric')} />
          <SettingField label={t('settings.field.model')} value={form.imgGenModel} onChange={(value) => update('imgGenModel', value)} placeholder={t('settings.placeholder.modelImg')} below={<ImgModelPresets baseUrl={form.imgGenBaseUrl} current={form.imgGenModel} onPick={(model) => update('imgGenModel', model)} />} />
          <Collapse label={t('settings.field.advancedBaseUrl')} open={imgUrlOpen} onOpenChange={setImgUrlOpen}>
            <SettingField label={t('settings.field.baseUrl')} value={form.imgGenBaseUrl} onChange={(value) => update('imgGenBaseUrl', value)} placeholder="https://api.openai.com/v1" />
          </Collapse>
        </Section>

        <section className="settings-privacy" aria-labelledby="settings-privacy-title">
          <h2 id="settings-privacy-title">{t('settings.privacy.title')}</h2>
          <p>{t('settings.privacy.description')}</p>
          <label className="settings-checkbox">
            <input type="checkbox" checked={form.rememberKeys} onChange={(event) => update('rememberKeys', event.target.checked)} />
            <span>{t('settings.privacy.remember')}</span>
          </label>
          <p className="settings-privacy-detail">{form.rememberKeys ? t('settings.privacy.persistent') : t('settings.privacy.temporary')}</p>
          <button type="button" className="settings-clear" disabled={!hasKeys && !settings.rememberKeys} onClick={handleClear}>{t('settings.action.clearKeys')}</button>
          {cleared && <p role="status">{t('settings.action.keysCleared')}</p>}
        </section>

        <p className="settings-test-note">{t('settings.test.draftHint')}</p>
        <TestResult result={testResult} error={testError} />
        <ActionBar saved={saved} testing={testing} dirty={dirty} onSave={handleSave} onTest={handleTest} />
        <Footer />
      </main>
    </div>
  )
}

function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return <fieldset className="settings-field-group"><legend>{label}</legend>{children}</fieldset>
}
