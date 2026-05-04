import { describe, it, expect } from 'vitest'
import { LLM_PROVIDERS, findProviderByBaseUrl, findImageModel } from './llmProviders'

describe('LLM_PROVIDERS', () => {
  it('每个 provider 都有必填字段', () => {
    for (const p of LLM_PROVIDERS) {
      expect(p.id).toBeTruthy()
      expect(p.name).toBeTruthy()
      // custom 是特例，baseUrl 允许为空
      if (p.id !== 'custom') expect(p.baseUrl).toBeTruthy()
    }
  })

  it('包含核心几家厂商', () => {
    const ids = LLM_PROVIDERS.map((p) => p.id)
    expect(ids).toContain('anthropic')
    expect(ids).toContain('openai')
    expect(ids).toContain('custom')
    // 不应再包含任何具体中转品牌
    expect(ids).not.toContain('apiyi')
    expect(ids).not.toContain('compat-cn')
  })

  it('每个 chatModels 列表至少有一个 recommended（custom 除外）', () => {
    for (const p of LLM_PROVIDERS) {
      if (p.id === 'custom') continue
      if (p.chatModels.length === 0) continue
      expect(p.chatModels.some((m) => m.recommended)).toBe(true)
    }
  })
})

describe('findProviderByBaseUrl', () => {
  it('精确匹配 base URL', () => {
    expect(findProviderByBaseUrl('https://api.anthropic.com')?.id).toBe('anthropic')
    // 旧的中转 baseUrl 不再预设，应回退到 null（让 UI 走"自定义"分支）
    expect(findProviderByBaseUrl('https://api.apiyi.com/v1')).toBeNull()
  })

  it('结尾斜杠不影响匹配', () => {
    expect(findProviderByBaseUrl('https://api.anthropic.com/')?.id).toBe('anthropic')
  })

  it('未知 URL 返回 null（自定义场景）', () => {
    expect(findProviderByBaseUrl('http://localhost:11434')).toBeNull()
    expect(findProviderByBaseUrl('')).toBeNull()
  })
})

describe('findImageModel', () => {
  it('精确匹配常见图片模型', () => {
    expect(findImageModel('dall-e-3')?.id).toBe('dall-e-3')
    expect(findImageModel('flux-schnell')?.id).toBe('flux-schnell')
    expect(findImageModel('gpt-image-2')?.id).toBe('gpt-image-2')
  })

  it('大小写不敏感 + 支持中转商前缀', () => {
    expect(findImageModel('DALL-E-3')?.id).toBe('dall-e-3')
    expect(findImageModel('openai/dall-e-3')?.id).toBe('dall-e-3')
    expect(findImageModel('models/flux-schnell-v1')?.id).toBe('flux-schnell')
  })

  it('携带成本估算字段', () => {
    const dalle = findImageModel('dall-e-3')!
    expect(dalle.priceUSD).toBeGreaterThan(0)
    expect(dalle.seconds).toBeGreaterThan(0)
  })

  it('gpt-image-2 标记为 slow', () => {
    expect(findImageModel('gpt-image-2')?.slow).toBe(true)
  })

  it('未知模型返回 null', () => {
    expect(findImageModel('unknown-model')).toBeNull()
    expect(findImageModel('')).toBeNull()
  })
})
