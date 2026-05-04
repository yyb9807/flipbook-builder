import {
  findProviderByBaseUrl,
  findImageModel,
  LLM_PROVIDERS,
  EXTRA_IMAGE_MODELS,
} from '../../utils/llmProviders'
import type { LLMModel } from '../../utils/llmProviders'
import { Chip } from './Chip'

interface Props {
  baseUrl: string
  current: string
  onPick: (id: string) => void
}

/**
 * 图片生成模型快选。优先用匹配 provider 的 imageModels；自定义厂商时
 * fallback 到所有 provider imageModels 的去重并集（覆盖常见三档：flux / dall-e-3 / gpt-image）。
 */
export function ImgModelPresets({ baseUrl, current, onPick }: Props) {
  const provider = findProviderByBaseUrl(baseUrl)
  const providerModels = provider?.imageModels ?? []
  const models: LLMModel[] = providerModels.length > 0 ? providerModels : collectAllImageModels()

  if (models.length === 0) return null

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {models.map((m) => {
        const meta = findImageModel(m.id)
        return (
          <Chip
            key={m.id}
            label={m.label || m.id}
            active={current === m.id}
            tone={meta?.tone ?? 'blue'}
            hint={m.hint || m.speedLabel}
            recommended={m.recommended}
            title={m.hint}
            onClick={() => onPick(m.id)}
          />
        )
      })}
    </div>
  )
}

/** fallback：自定义厂商时给个图片模型并集（所有 provider 声明 + 额外常用模型，按 id 去重）。 */
function collectAllImageModels(): LLMModel[] {
  const seen = new Set<string>()
  const out: LLMModel[] = []
  const push = (m: LLMModel) => {
    if (seen.has(m.id)) return
    seen.add(m.id)
    out.push(m)
  }
  for (const p of LLM_PROVIDERS) (p.imageModels ?? []).forEach(push)
  EXTRA_IMAGE_MODELS.forEach(push)
  return out
}
