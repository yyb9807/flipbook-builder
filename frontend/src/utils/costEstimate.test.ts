import { describe, it, expect } from 'vitest'
import { estimateCost, estimateSeconds } from './costEstimate'

describe('estimateCost', () => {
  it('已知模型返回带 ¥ 的字符串', () => {
    const c = estimateCost({ imgGenModel: 'dall-e-3', imageCount: 4 })
    expect(c).toMatch(/^约 ¥/)
  })

  it('imageCount 越多，费用越高', () => {
    const c1 = estimateCost({ imgGenModel: 'dall-e-3', imageCount: 1 })
    const c4 = estimateCost({ imgGenModel: 'dall-e-3', imageCount: 4 })
    // 提取数字比较
    const n1 = parseFloat(c1!.replace(/[^\d.]/g, ''))
    const n4 = parseFloat(c4!.replace(/[^\d.]/g, ''))
    expect(n4).toBeGreaterThan(n1)
  })

  it('flux-schnell 比 dall-e-3 便宜（同等数量）', () => {
    const flux = estimateCost({ imgGenModel: 'flux-schnell', imageCount: 4 })
    const dalle = estimateCost({ imgGenModel: 'dall-e-3', imageCount: 4 })
    const fluxN = parseFloat(flux!.replace(/[^\d.]/g, ''))
    const dalleN = parseFloat(dalle!.replace(/[^\d.]/g, ''))
    expect(fluxN).toBeLessThan(dalleN)
  })

  it('未知模型返回 null', () => {
    expect(estimateCost({ imgGenModel: 'no-such-model' })).toBeNull()
  })

  it('费用 < 0.1 元时显示两位小数', () => {
    const c = estimateCost({ imgGenModel: 'flux-schnell', imageCount: 1, llmCalls: 0 })
    // flux 单张 0.003 USD * 7.2 = 0.0216 元
    expect(c).toMatch(/^约 ¥\d+\.\d{2}$/)
  })

  it('llmCalls 默认等于 imageCount', () => {
    const cExplicit = estimateCost({ imgGenModel: 'dall-e-3', imageCount: 4, llmCalls: 4 })
    const cImplicit = estimateCost({ imgGenModel: 'dall-e-3', imageCount: 4 })
    expect(cExplicit).toBe(cImplicit)
  })
})

describe('estimateSeconds', () => {
  it('单张返回模型的 seconds 字段', () => {
    expect(estimateSeconds('dall-e-3', 1)).toBe(40)
    expect(estimateSeconds('flux-schnell', 1)).toBe(6)
  })

  it('多张并行约为单张的 1.3 倍', () => {
    const s1 = estimateSeconds('dall-e-3', 1)
    const s4 = estimateSeconds('dall-e-3', 4)
    expect(s4).toBeGreaterThan(s1)
    expect(s4).toBeLessThan(s1 * 2) // 不会线性增长
  })

  it('未知模型走 fallback', () => {
    const s = estimateSeconds('unknown-model', 3)
    expect(s).toBe(90) // 3 * 30
  })
})
