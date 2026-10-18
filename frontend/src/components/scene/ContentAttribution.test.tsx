import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ContentAttribution } from './ContentAttribution'
import type { ContentMetadata } from '../../types'

afterEach(cleanup)

const metadata: ContentMetadata = {
  version: 1, provenance: { kind: 'ai', input_kind: 'parent_page', model: 'demo-content-model' },
  references: [{ id: 'book', title: '作者提供的水循环资料', url: 'https://example.org/water', note: '第 2 章。' }],
  review_status: 'unreviewed',
}

describe('shared references and creation notes', () => {
  it('separates generation information, author references and review status', () => {
    render(<ContentAttribution metadata={metadata} />)
    expect(screen.getByText(/AI 辅助生成 · 上级页面 · 模型：demo-content-model/)).toBeInTheDocument()
    expect(screen.getByText('尚未人工核对。')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '作者提供的水循环资料' })).toHaveAttribute('href', 'https://example.org/water')
    expect(screen.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByText(/系统未抓取或核验/)).toBeInTheDocument()
  })

  it('never invents AI provenance or verified references for an older page', () => {
    render(<ContentAttribution />)
    expect(screen.getByText('未记录生成方式。')).toBeInTheDocument()
    expect(screen.getByText('本页未附参考资料。')).toBeInTheDocument()
    expect(screen.queryByText(/AI 辅助生成/)).not.toBeInTheDocument()
    expect(screen.queryByText('尚未人工核对。')).not.toBeInTheDocument()
  })

  it('shows the author declaration in English without rendering dangerous URLs or HTML', () => {
    const { container } = render(<ContentAttribution metadata={{ ...metadata, review_status: 'reviewed', references: [{ id: 'bad', title: '<script>bad()</script>', url: 'javascript:bad()', note: '<img src=x onerror=bad()>' }] }} locale="en" />)
    expect(screen.getByText('The author states that they reviewed this page.')).toBeInTheDocument()
    expect(screen.getByText('<script>bad()</script>')).toBeInTheDocument()
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
