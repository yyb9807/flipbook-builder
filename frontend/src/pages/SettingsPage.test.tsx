import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { SettingsPage } from './SettingsPage'
import { DEFAULT_MODEL_SETTINGS, useSettingsStore } from '../store/settingsStore'
import { useI18nStore } from '../i18n'
import { api } from '../api/client'

vi.mock('../api/client', () => ({ api: { testConfig: vi.fn() } }))

beforeEach(() => {
  useI18nStore.setState({ locale: 'zh' })
  useSettingsStore.setState({ ...DEFAULT_MODEL_SETTINGS, llmApiKey: 'active-key' })
  vi.clearAllMocks()
})
afterEach(cleanup)

function renderSettings() {
  render(<MemoryRouter><SettingsPage /></MemoryRouter>)
  return screen.getByRole('region', { name: '内容理解' })
}

describe('settings draft safety', () => {
  it('changing provider clears its draft key while retaining other credentials', async () => {
    const user = userEvent.setup()
    useSettingsStore.setState({ imgGenApiKey: 'active-image-key' })
    const llm = renderSettings()
    await user.click(within(llm).getByRole('button', { name: 'OpenAI（官方）' }))
    expect(within(llm).getByLabelText('API Key')).toHaveValue('')
    expect(within(screen.getByRole('region', { name: '图片生成' })).getByLabelText('API Key')).toHaveValue('active-image-key')
    expect(useSettingsStore.getState().llmApiKey).toBe('active-key')
  })

  it('changing a custom address also clears the corresponding draft key', async () => {
    const user = userEvent.setup()
    const llm = renderSettings()
    await user.click(within(llm).getByRole('button', { name: '高级:自定义 Base URL' }))
    const address = within(llm).getByLabelText('API Base URL')
    await user.clear(address)
    await user.type(address, 'https://custom.example/v1')
    expect(address).toHaveValue('https://custom.example/v1')
    expect(address).toHaveFocus()
    expect(within(llm).getByLabelText('API Key')).toHaveValue('')
  })

  it('testing uses the unsaved draft and does not change active settings', async () => {
    const user = userEvent.setup()
    const entry = { ok: true, key_length: 12, model: 'test', base_url: 'https://api.example', error: null, latency_ms: 10 }
    vi.mocked(api.testConfig).mockResolvedValue({ llm: entry, imggen: entry })
    const llm = renderSettings()
    const key = within(llm).getByLabelText('API Key')
    await user.clear(key)
    await user.type(key, 'draft-secret')
    await user.click(screen.getByRole('button', { name: '测试连接' }))
    expect(api.testConfig).toHaveBeenCalledWith(expect.objectContaining({ llmApiKey: 'draft-secret' }))
    expect(useSettingsStore.getState().llmApiKey).toBe('active-key')
    expect(await screen.findByText('LLM · 连接成功')).toBeInTheDocument()
  })

  it('clearing removes persisted keys and unchecks remembering keys', async () => {
    const user = userEvent.setup()
    useSettingsStore.getState().updateSettings({ rememberKeys: true, imgGenApiKey: 'image-secret' })
    const llm = renderSettings()
    await user.click(screen.getByRole('button', { name: '清除已输入和保存的密钥' }))
    expect(within(llm).getByLabelText('API Key')).toHaveValue('')
    expect(screen.getByRole('checkbox', { name: '在此浏览器记住密钥' })).not.toBeChecked()
    expect(localStorage.getItem('flipbook-settings')).not.toContain('image-secret')
    expect(useSettingsStore.getState()).toMatchObject({ llmApiKey: '', imgGenApiKey: '', rememberKeys: false })
  })
})
