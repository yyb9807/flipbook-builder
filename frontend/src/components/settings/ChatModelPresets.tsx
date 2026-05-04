import { findProviderByBaseUrl } from '../../utils/llmProviders'
import { Chip } from './Chip'

interface Props {
  baseUrl: string
  current: string
  onPick: (modelId: string) => void
}

/**
 * 文本/视觉 LLM 模型选择 chip 行。
 * 根据当前 base URL 自动过滤显示对应厂商的模型清单；找不到匹配（自定义）则不渲染。
 */
export function ChatModelPresets({ baseUrl, current, onPick }: Props) {
  const provider = findProviderByBaseUrl(baseUrl)
  if (!provider || provider.chatModels.length === 0) return null

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {provider.chatModels.map((m) => (
        <Chip
          key={m.id}
          label={m.label}
          active={current === m.id}
          hint={m.hint}
          recommended={m.recommended}
          title={m.hint}
          onClick={() => onPick(m.id)}
        />
      ))}
    </div>
  )
}
