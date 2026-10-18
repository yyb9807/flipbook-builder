import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { UploadZone } from './UploadZone'
import { useCreationStore } from '../../store/creationStore'
import { DEFAULT_MODEL_SETTINGS, useSettingsStore } from '../../store/settingsStore'

beforeEach(() => {
  useCreationStore.setState({ tab: 'text', topic: '水循环', generateImages: false, file: null })
  useSettingsStore.setState({ ...DEFAULT_MODEL_SETTINGS, llmApiKey: 'test-content-only-key', imgGenApiKey: '' })
})
afterEach(cleanup)

describe('knowledge-page creation choices', () => {
  it('creates content without requiring an image provider', () => {
    const onText = vi.fn()
    render(<MemoryRouter><UploadZone loading={false} onText={onText} onFile={vi.fn()} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '用 AI 创建' }))
    expect(onText).toHaveBeenCalledWith('水循环', false)
    expect(screen.queryByRole('link', { name: '配置 AI 服务' })).not.toBeInTheDocument()
  })
  it('requires image setup only after the author selects an illustration', () => {
    const onText = vi.fn()
    render(<MemoryRouter><UploadZone loading={false} onText={onText} onFile={vi.fn()} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('checkbox', { name: '同时生成插图（可选）' }))
    expect(screen.getByRole('link', { name: '配置 AI 服务' })).toBeVisible()
    expect(onText).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox', { name: '同时生成插图（可选）' }))
    expect(screen.getByRole('button', { name: '用 AI 创建' })).toBeEnabled()
    expect(useCreationStore.getState().topic).toBe('水循环')
  })
})
