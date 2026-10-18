import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_MODEL_SETTINGS, useSettingsStore } from './settingsStore'

function persistedSettings() {
  return JSON.parse(localStorage.getItem('flipbook-settings') ?? '{}').state
}

beforeEach(() => {
  useSettingsStore.setState(DEFAULT_MODEL_SETTINGS)
})

describe('credential storage', () => {
  it('keeps keys in memory by default while retaining provider choices', () => {
    useSettingsStore.getState().updateSettings({ llmApiKey: 'private-llm', imgGenApiKey: 'private-image', llmModel: 'my-model' })
    expect(useSettingsStore.getState().llmApiKey).toBe('private-llm')
    expect(persistedSettings()).toMatchObject({ llmApiKey: '', imgGenApiKey: '', llmModel: 'my-model', rememberKeys: false })
  })

  it('stores keys only after explicit opt-in and removes stored copies on opt-out', () => {
    useSettingsStore.getState().updateSettings({ llmApiKey: 'private-llm', imgGenApiKey: 'private-image', rememberKeys: true })
    expect(persistedSettings().llmApiKey).toBe('private-llm')
    useSettingsStore.getState().updateSettings({ rememberKeys: false })
    expect(persistedSettings().llmApiKey).toBe('')
    expect(persistedSettings().imgGenApiKey).toBe('')
    expect(useSettingsStore.getState().llmApiKey).toBe('private-llm')
  })

  it('clears only the changed endpoint’s key when updating an endpoint independently', () => {
    useSettingsStore.getState().updateSettings({ llmApiKey: 'private-llm', imgGenApiKey: 'private-image' })
    useSettingsStore.getState().updateSettings({ llmBaseUrl: 'https://different.example/v1' })
    expect(useSettingsStore.getState()).toMatchObject({ llmApiKey: '', imgGenApiKey: 'private-image' })
  })

  it('clears current and saved credentials and withdraws opt-in', () => {
    useSettingsStore.getState().updateSettings({ llmApiKey: 'private-llm', imgGenApiKey: 'private-image', rememberKeys: true })
    useSettingsStore.getState().clearCredentials()
    expect(useSettingsStore.getState()).toMatchObject({ llmApiKey: '', imgGenApiKey: '', rememberKeys: false })
    expect(persistedSettings()).toMatchObject({ llmApiKey: '', imgGenApiKey: '', rememberKeys: false })
  })

  it('migrates old implicit persisted keys away and preserves explicit non-secret choices', async () => {
    localStorage.setItem('flipbook-settings', JSON.stringify({
      version: 0,
      state: { llmBaseUrl: 'https://chosen.example/v1', llmModel: 'chosen-model', llmApiKey: 'legacy-secret', imgGenApiKey: 'legacy-image' },
    }))
    await useSettingsStore.persist.rehydrate()
    expect(useSettingsStore.getState()).toMatchObject({ llmBaseUrl: 'https://chosen.example/v1', llmModel: 'chosen-model', llmApiKey: '', imgGenApiKey: '', rememberKeys: false })
    expect(localStorage.getItem('flipbook-settings')).not.toContain('legacy-secret')
    expect(localStorage.getItem('flipbook-settings')).not.toContain('legacy-image')
  })
})
