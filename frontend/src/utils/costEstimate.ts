/**
 * 简单的成本 / 时长估算 —— 用于在 CTA 按钮显示「约 ¥X.X · X 秒」。
 * 数字按主流中转商粗估，不是精确账单。
 */
import { findImageModel } from './llmProviders'

interface CostInputs {
  imgGenModel: string
  imageCount?: number
  llmCalls?: number
}

const LLM_CALL_USD = 0.008 // Claude Sonnet 一次文案调用估算
const USD_TO_CNY = 7.2

/** 返回带"约 ¥X.X"的中文字符串；模型未知则返回 null。 */
export function estimateCost({ imgGenModel, imageCount = 1, llmCalls }: CostInputs): string | null {
  const model = findImageModel(imgGenModel)
  if (!model || model.priceUSD == null) return null
  const calls = llmCalls ?? imageCount
  const usd = model.priceUSD * imageCount + LLM_CALL_USD * calls
  const cny = usd * USD_TO_CNY
  return cny < 0.1 ? `约 ¥${cny.toFixed(2)}` : `约 ¥${cny.toFixed(1)}`
}

/** 估算单批生成耗时（秒），并行场景 imageCount > 1 时略加余量。 */
export function estimateSeconds(imgGenModel: string, imageCount = 1): number {
  const model = findImageModel(imgGenModel)
  const seconds = model?.seconds
  if (!seconds) return imageCount * 30
  // 并行执行时取最慢的那张（约 1.3× 单张）作为总耗时估算
  return imageCount > 1 ? Math.round(seconds * 1.3) : seconds
}
