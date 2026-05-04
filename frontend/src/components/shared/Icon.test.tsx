import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { Icon } from './Icon'

describe('Icon', () => {
  afterEach(cleanup)

  it('渲染 SVG 元素', () => {
    const { container } = render(<Icon name="refresh" />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
  })

  it('支持自定义尺寸', () => {
    const { container } = render(<Icon name="refresh" size={32} />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('width', '32')
    expect(svg).toHaveAttribute('height', '32')
  })

  it('支持自定义 stroke 宽度', () => {
    const { container } = render(<Icon name="refresh" stroke={3} />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('stroke-width', '3')
  })

  it('aria-hidden=true（装饰性图标）', () => {
    const { container } = render(<Icon name="refresh" />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('所有定义的图标都能渲染（不抛错）', () => {
    const names: Parameters<typeof Icon>[0]['name'][] = [
      'arrow-right', 'arrow-left', 'plus', 'refresh', 'trash',
      'spark', 'image', 'gear', 'search', 'check', 'x', 'warning',
      'share', 'link', 'json', 'zip', 'pen',
    ]
    for (const name of names) {
      const { container, unmount } = render(<Icon name={name} />)
      expect(container.querySelector('svg')).toBeInTheDocument()
      unmount()
    }
  })
})
