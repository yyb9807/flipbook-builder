/**
 * LLM 厂商 / 中转商预设 — 单一 source of truth。
 *
 * 设计：用户在设置页选厂商 → 自动填 base URL，再从该厂商的常用模型里选一个 → 填 model id。
 * 「自定义」走原始裸输入，不限制 base URL / model 字段。
 *
 * 图片模型字段（priceUSD / seconds / tone / slow）顺带挂在 LLMModel 上，
 * 给成本估算 / 设置页 chip / 慢模型 warning 共用，避免另开一份 IMG_MODELS。
 */

export type LLMTaskKind = 'chat' | 'image'
export type ModelTone = 'green' | 'blue' | 'gray'

export interface LLMModel {
  /** 后端 API 用的 model id */
  id: string
  /** UI 显示名 */
  label: string
  /** 一句话说明（速度 / 强项 / 价位） */
  hint?: string
  /** 是否推荐为默认（每种 provider 至少一个，标 ★） */
  recommended?: boolean
  // ── 图片模型专属字段 ──
  /** 单张图费用（USD），用于成本估算 */
  priceUSD?: number
  /** 单张图典型耗时（秒），用于时长估算 */
  seconds?: number
  /** 设置页快捷按钮上显示的速度标签（fallback 用，新版优先用 hint） */
  speedLabel?: string
  /** 按钮 active 时的高亮色 */
  tone?: ModelTone
  /** 是否慢到需要在生成前给用户 warning */
  slow?: boolean
}

export interface LLMProvider {
  /** 内部 id，用于持久化匹配 */
  id: string
  /** UI 显示名 */
  name: string
  /** 简短描述 */
  description?: string
  /** API 基地址，匹配后端 OpenAI 兼容 / Anthropic 路径 */
  baseUrl: string
  /** 文本 / 视觉 LLM 模型清单 */
  chatModels: LLMModel[]
  /** 图片生成模型清单（部分厂商兼有） */
  imageModels?: LLMModel[]
  /** 注册 / 文档链接 */
  docsUrl?: string
}

// 三档常用图片模型的元信息（单点定义，多个 provider 复用）。
const IMG_FLUX_SCHNELL: LLMModel = {
  id: 'flux-schnell',
  label: 'Flux Schnell',
  hint: '~5s · 最便宜',
  priceUSD: 0.003,
  seconds: 6,
  speedLabel: '~5s',
  tone: 'green',
}
const IMG_DALLE_3: LLMModel = {
  id: 'dall-e-3',
  label: 'DALL-E 3',
  hint: '~60s · 质量高',
  recommended: true,
  priceUSD: 0.04,
  seconds: 40,
  speedLabel: '~60s',
  tone: 'blue',
}
const IMG_GPT_IMAGE_2: LLMModel = {
  id: 'gpt-image-2',
  label: 'GPT-Image-2',
  hint: '⚠ 慢 · ~4 分钟',
  priceUSD: 0.05,
  seconds: 180,
  speedLabel: '~4分钟 ⚠',
  tone: 'gray',
  slow: true,
}
const IMG_GPT_IMAGE_1: LLMModel = {
  id: 'gpt-image-1',
  label: 'GPT-Image-1',
  hint: '文字渲染好',
  priceUSD: 0.04,
  seconds: 30,
  speedLabel: '~30s',
  tone: 'blue',
}

// ─────────────────────────────────────────────────────────────────
// Provider 清单。新增模型/厂商在这里改一处就够。
// ─────────────────────────────────────────────────────────────────
export const LLM_PROVIDERS: readonly LLMProvider[] = [
  {
    id: 'anthropic',
    name: 'Anthropic（官方）',
    description: 'Claude 系列，支持 prompt caching 节省 90% 重复 system prompt 成本',
    baseUrl: 'https://api.anthropic.com',
    docsUrl: 'https://console.anthropic.com/',
    chatModels: [
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', hint: '推荐 · 视觉强 · $3/M', recommended: true },
      { id: 'claude-opus-4-5', label: 'Claude Opus 4.5', hint: '最强 · 适合复杂规划 · $15/M' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', hint: '快 · 便宜 · $0.8/M' },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI（官方）',
    description: 'GPT-4 / GPT-Image 系列',
    baseUrl: 'https://api.openai.com/v1',
    docsUrl: 'https://platform.openai.com/',
    chatModels: [
      { id: 'gpt-4.1', label: 'GPT-4.1', hint: '推荐 · 视觉强 · $2/M', recommended: true },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', hint: '快 · 便宜 · $0.15/M' },
      { id: 'gpt-5', label: 'GPT-5', hint: '最新旗舰 · 复杂推理' },
    ],
    imageModels: [IMG_DALLE_3, IMG_GPT_IMAGE_1],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: '统一聚合多家 LLM，一个 key 用 100+ 模型',
    baseUrl: 'https://openrouter.ai/api/v1',
    docsUrl: 'https://openrouter.ai/',
    chatModels: [
      { id: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6 (via OR)', hint: '推荐 · OR 转发', recommended: true },
      { id: 'openai/gpt-4.1', label: 'GPT-4.1 (via OR)', hint: 'OpenAI 转发' },
      { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', hint: '视觉超强 · 长上下文' },
      { id: 'meta-llama/llama-4-maverick', label: 'Llama 4 Maverick', hint: '开源 · 便宜' },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek（官方）',
    description: '国内厂商，价格极低，文本能力强但暂不支持视觉',
    baseUrl: 'https://api.deepseek.com',
    docsUrl: 'https://platform.deepseek.com/',
    chatModels: [
      { id: 'deepseek-chat', label: 'DeepSeek V3', hint: '通用 · $0.14/M', recommended: true },
      { id: 'deepseek-reasoner', label: 'DeepSeek R1', hint: '推理强 · 慢' },
    ],
  },
  {
    id: 'custom',
    name: '自定义',
    description: '完全自定义 base URL 和 model id（Ollama 本地 / 私有部署 / 其他中转）',
    baseUrl: '',
    chatModels: [],
  },
]

/** 根据 base URL 反查 provider id（用于已保存配置时高亮当前 provider）。 */
export function findProviderByBaseUrl(baseUrl: string): LLMProvider | null {
  if (!baseUrl) return null
  const normalized = baseUrl.replace(/\/$/, '')
  for (const p of LLM_PROVIDERS) {
    if (p.id === 'custom') continue
    if (p.baseUrl.replace(/\/$/, '') === normalized) return p
  }
  return null
}

/**
 * 自定义厂商常用的图片模型，单独维护一份以保留成本估算 / 慢模型 warning。
 * 不挂在任何 provider 上（避免在 ProviderPicker 里出现具体中转品牌），
 * 但 findImageModel / Custom 模式 ImgModelPresets 都会读它。
 */
export const EXTRA_IMAGE_MODELS: readonly LLMModel[] = [IMG_FLUX_SCHNELL, IMG_GPT_IMAGE_2]

/**
 * 模糊匹配图片模型元信息（中转商可能在 model id 前后加前缀，所以走 substring）。
 * 遍历所有 provider 的 imageModels + EXTRA_IMAGE_MODELS，返回第一个匹配的；未知返回 null。
 * 给 costEstimate / 慢模型 warning / chip tone 共用。
 */
export function findImageModel(modelId: string): LLMModel | null {
  if (!modelId) return null
  const m = modelId.toLowerCase()
  const seen = new Set<string>()
  const sources: LLMModel[][] = [
    ...LLM_PROVIDERS.map((p) => p.imageModels ?? []),
    [...EXTRA_IMAGE_MODELS],
  ]
  for (const list of sources) {
    for (const x of list) {
      if (seen.has(x.id)) continue
      seen.add(x.id)
      if (m.includes(x.id.toLowerCase())) return x
    }
  }
  return null
}
