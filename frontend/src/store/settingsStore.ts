import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SettingsState {
  llmBaseUrl: string
  llmApiKey: string
  llmModel: string
  imgGenBaseUrl: string
  imgGenApiKey: string
  imgGenModel: string
  updateSettings: (s: Partial<Omit<SettingsState, 'updateSettings'>>) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      llmBaseUrl: 'https://api.anthropic.com',
      llmApiKey: '',
      llmModel: 'claude-sonnet-4-6',
      imgGenBaseUrl: 'https://api.apiyi.com/v1',
      imgGenApiKey: '',
      imgGenModel: 'dall-e-3',
      updateSettings: (s) => set(s),
    }),
    { name: 'flipbook-settings' }
  )
)
