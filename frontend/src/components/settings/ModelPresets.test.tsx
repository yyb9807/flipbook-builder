import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatModelPresets } from './ChatModelPresets'
import { ImgModelPresets } from './ImgModelPresets'
import { useI18nStore } from '../../i18n'
import { EXTRA_IMAGE_MODELS, LLM_PROVIDERS } from '../../utils/llmProviders'

beforeEach(() => useI18nStore.setState({ locale: 'en' }))
afterEach(cleanup)

describe('existing model preset localization', () => {
  it.each(LLM_PROVIDERS.filter((provider) => provider.chatModels.length > 0))('localizes $id chat hints while preserving preset selection', (provider) => {
    const pick = vi.fn()
    const before = JSON.stringify(provider)
    render(<ChatModelPresets baseUrl={provider.baseUrl} current={provider.chatModels[0].id} onPick={pick} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(provider.chatModels.length)
    buttons.forEach((button, index) => {
      expect(button.textContent).toContain(provider.chatModels[index].label)
      expect(button.textContent).not.toMatch(/[\u3400-\u9fff]/)
      expect(button.title).not.toMatch(/[\u3400-\u9fff]/)
      for (const priceToken of provider.chatModels[index].hint?.match(/\$[^ ]+/g) ?? []) expect(button.title).toContain(priceToken)
    })
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(buttons[0])
    expect(pick).toHaveBeenCalledWith(provider.chatModels[0].id)
    expect(JSON.stringify(provider)).toBe(before)
  })

  it('translates image hints and tooltips in the custom-provider fallback without changing its model choices', () => {
    const pick = vi.fn()
    const before = JSON.stringify([LLM_PROVIDERS, EXTRA_IMAGE_MODELS])
    render(<ImgModelPresets baseUrl="https://custom.example/v1" current={EXTRA_IMAGE_MODELS[0].id} onPick={pick} />)
    const buttons = screen.getAllByRole('button')
    buttons.forEach((button) => {
      expect(button.textContent).not.toMatch(/[\u3400-\u9fff]/)
      expect(button.title).not.toMatch(/[\u3400-\u9fff]/)
    })
    expect(screen.getByRole('button', { name: /Good text rendering/ })).toHaveAttribute('title', 'Good text rendering')
    expect(screen.getByRole('button', { name: /Slow/ })).toHaveAttribute('title', 'Slow · ~4 min')
    fireEvent.click(screen.getByRole('button', { pressed: true }))
    expect(pick).toHaveBeenCalledWith(EXTRA_IMAGE_MODELS[0].id)
    expect(JSON.stringify([LLM_PROVIDERS, EXTRA_IMAGE_MODELS])).toBe(before)
  })

  it('switches existing hints back to Chinese with the rest of the interface', () => {
    const provider = LLM_PROVIDERS.find((entry) => entry.chatModels.length > 0)!
    render(<ChatModelPresets baseUrl={provider.baseUrl} current={provider.chatModels[0].id} onPick={() => {}} />)
    expect(screen.getAllByRole('button')[0]).toHaveTextContent('Recommended')
    act(() => useI18nStore.setState({ locale: 'zh' }))
    expect(screen.getAllByRole('button')[0]).toHaveTextContent('推荐')
    expect(screen.getAllByRole('button')[0]).toHaveAttribute('title', provider.chatModels[0].hint)
  })
})
