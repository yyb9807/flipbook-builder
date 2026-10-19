import type { Locale } from '../../i18n'

// Translate the existing catalog's labels without changing its models or metadata.
const ENGLISH_HINTS: Record<string, string> = {
  '推荐': 'Recommended',
  '视觉强': 'Strong vision',
  '最强': 'Most capable',
  '适合复杂规划': 'For complex planning',
  '快': 'Fast',
  '便宜': 'Low cost',
  '最新旗舰': 'Latest flagship',
  '复杂推理': 'Complex reasoning',
  'OR 转发': 'Via OpenRouter',
  'OpenAI 转发': 'OpenAI via relay',
  '视觉超强': 'Very strong vision',
  '长上下文': 'Long context',
  '开源': 'Open source',
  '通用': 'General purpose',
  '推理强': 'Strong reasoning',
  '慢': 'Slow',
  '最便宜': 'Lowest cost',
  '质量高': 'High quality',
  '⚠ 慢': 'Slow',
  '~4 分钟': '~4 min',
  '~4分钟 ⚠': '~4 min',
  '文字渲染好': 'Good text rendering',
}

export function localizedModelHint(hint: string | undefined, locale: Locale): string | undefined {
  if (!hint || locale === 'zh') return hint
  return hint.split(' · ').map((part) => ENGLISH_HINTS[part] ?? part).join(' · ')
}
