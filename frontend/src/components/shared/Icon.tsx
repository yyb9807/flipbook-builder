import type { CSSProperties } from 'react'

export type IconName =
  | 'arrow-right'
  | 'arrow-left'
  | 'plus'
  | 'refresh'
  | 'trash'
  | 'spark'
  | 'image'
  | 'gear'
  | 'search'
  | 'check'
  | 'x'
  | 'warning'
  | 'share'
  | 'link'
  | 'json'
  | 'zip'
  | 'pen'

interface Props {
  name: IconName
  size?: number
  stroke?: number
  style?: CSSProperties
  className?: string
}

/**
 * 统一的 SVG 图标组件 —— 24×24 viewBox，line-icon 风格。
 * 替代项目里散落的 29 个内联 SVG（重复刷新、箭头、加号等图形）。
 */
export function Icon({ name, size = 14, stroke = 1.8, style, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}

// ──────────────────────────────────────────
// Path 库 —— 全部 24x24 viewBox
// ──────────────────────────────────────────
const PATHS: Record<IconName, JSX.Element> = {
  'arrow-right': <path d="M5 12h14M13 5l7 7-7 7" />,
  'arrow-left': <path d="M15 6l-9 6 9 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: <path d="M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5" />,
  trash: <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />,
  spark: <path d="M12 2l2 7 7 2-7 2-2 7-2-7-7-2 7-2z" />,
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="M21 15l-5-5L5 21" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.07 4.93L17.66 6.34M6.34 17.66l-1.41 1.41M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M21 12h-2M5 12H3M12 3V1M12 23v-2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.3-4.3" />
    </>
  ),
  check: <path d="M20 6L9 17l-5-5" />,
  x: <path d="M18 6L6 18M6 6l12 12" />,
  warning: (
    <>
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),
  share: <path d="M4 12v7a2 2 0 002 2h12a2 2 0 002-2v-7M16 6l-4-4-4 4M12 2v13" />,
  link: (
    <>
      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
    </>
  ),
  json: (
    <>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6M9 13h6M9 17h6" />
    </>
  ),
  zip: <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" />,
  pen: <path d="M12 19l7-7 3 3-7 7-3-3zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5zM2 2l7.586 7.586M11 11a2 2 0 100-4 2 2 0 000 4z" />,
}
