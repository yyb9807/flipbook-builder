import { LLM_PROVIDERS, findProviderByBaseUrl } from '../../utils/llmProviders'
import type { LLMProvider } from '../../utils/llmProviders'
import { Chip } from './Chip'
import { useI18n } from '../../i18n'
import type { TranslationKey } from '../../i18n'

interface Props {
  currentBaseUrl: string
  onPick: (provider: LLMProvider) => void
  kind?: 'chat' | 'image'
}

/**
 * 厂商快选 chip 行。点击后通过 onPick 让父组件更新 base URL（+ 可选地推荐一个默认 model）。
 * 当前 base URL 命中某个 provider 时高亮。「自定义」永远显示，匹配不到任何 provider 时也高亮它。
 *
 * 不带自己的 label，标签由父组件用 FieldGroup 提供（避免双重 label）。
 */
export function ProviderPicker({ currentBaseUrl, onPick, kind = 'chat' }: Props) {
  const { t } = useI18n()
  const currentMatch = findProviderByBaseUrl(currentBaseUrl)
  const isCustom = !currentMatch

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {LLM_PROVIDERS.filter((provider) => kind === 'chat' || provider.id === 'custom' || !!provider.imageModels?.length).map((p) => {
        const active = p.id === 'custom' ? isCustom : currentMatch?.id === p.id
        return (
          <Chip
            key={p.id}
            label={t(`provider.${p.id}` as TranslationKey)}
            active={active}
            font="sans"
            size="md"
            title={p.description}
            onClick={() => onPick(p)}
          />
        )
      })}
    </div>
  )
}
