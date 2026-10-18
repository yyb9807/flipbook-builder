import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface ModelSettings {
  llmBaseUrl: string
  llmApiKey: string
  llmModel: string
  imgGenBaseUrl: string
  imgGenApiKey: string
  imgGenModel: string
  rememberKeys: boolean
}

interface SettingsState extends ModelSettings {
  updateSettings: (settings: Partial<ModelSettings>) => void
  clearCredentials: () => void
}

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  llmBaseUrl: 'https://api.anthropic.com',
  llmApiKey: '',
  llmModel: 'claude-sonnet-4-6',
  imgGenBaseUrl: 'https://api.openai.com/v1',
  imgGenApiKey: '',
  imgGenModel: 'dall-e-3',
  rememberKeys: false,
}

export function sameEndpoint(first: string, second: string): boolean {
  return first.trim().replace(/\/+$/, '') === second.trim().replace(/\/+$/, '')
}

/** Credentials live in memory unless the user explicitly opts into browser storage. */
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_MODEL_SETTINGS,
      updateSettings: (updates) => set((state) => ({
        ...updates,
        ...(updates.llmBaseUrl !== undefined && !sameEndpoint(updates.llmBaseUrl, state.llmBaseUrl)
          && updates.llmApiKey === undefined ? { llmApiKey: '' } : {}),
        ...(updates.imgGenBaseUrl !== undefined && !sameEndpoint(updates.imgGenBaseUrl, state.imgGenBaseUrl)
          && updates.imgGenApiKey === undefined ? { imgGenApiKey: '' } : {}),
      })),
      clearCredentials: () => set({ llmApiKey: '', imgGenApiKey: '', rememberKeys: false }),
    }),
    {
      name: 'flipbook-settings',
      version: 1,
      partialize: (state) => ({
        llmBaseUrl: state.llmBaseUrl,
        llmModel: state.llmModel,
        imgGenBaseUrl: state.imgGenBaseUrl,
        imgGenModel: state.imgGenModel,
        rememberKeys: state.rememberKeys,
        llmApiKey: state.rememberKeys ? state.llmApiKey : '',
        imgGenApiKey: state.rememberKeys ? state.imgGenApiKey : '',
      }),
      // Old versions saved keys without asking. Keep endpoint/model choices only.
      migrate: (persisted) => {
        const previous = (persisted ?? {}) as Partial<ModelSettings>
        return {
          ...DEFAULT_MODEL_SETTINGS,
          ...(typeof previous.llmBaseUrl === 'string' ? { llmBaseUrl: previous.llmBaseUrl } : {}),
          ...(typeof previous.llmModel === 'string' ? { llmModel: previous.llmModel } : {}),
          ...(typeof previous.imgGenBaseUrl === 'string' ? { imgGenBaseUrl: previous.imgGenBaseUrl } : {}),
          ...(typeof previous.imgGenModel === 'string' ? { imgGenModel: previous.imgGenModel } : {}),
        }
      },
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<ModelSettings>
        return {
          ...current,
          ...saved,
          llmApiKey: saved.rememberKeys ? saved.llmApiKey ?? '' : '',
          imgGenApiKey: saved.rememberKeys ? saved.imgGenApiKey ?? '' : '',
        }
      },
    }
  )
)
