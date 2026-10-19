import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

  it('shows saved excerpts, revision and license as author-selected evidence without claiming verification', () => {
    const excerpt = 'Saved source text.\nA second line remains available offline.'
    render(<ContentAttribution metadata={{ version: 1, review_status: 'unreviewed', references: [{ id: 'source', title: 'Water source', excerpt, locator: 'Chapter 2', source_revision: '123', retrieved_at: '2026-10-19T04:00:00+00:00', license_title: 'CC BY-SA 4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0/' }] }} locale="en" />)
    expect(screen.getByText('Chapter 2')).toBeVisible()
    expect(screen.getByText('Source revision 123')).toBeVisible()
    expect(screen.getByText('Saved 2026-10-19')).toBeVisible()
    const license = screen.getByRole('link', { name: 'CC BY-SA 4.0' })
    expect(license).toHaveAttribute('href', 'https://creativecommons.org/licenses/by-sa/4.0/')
    expect(license).toHaveAttribute('rel', 'noopener noreferrer')
    const savedText = screen.getByText(/Saved source text/)
    expect(savedText).not.toBeVisible()
    fireEvent.click(screen.getByText('Read saved excerpt'))
    expect(savedText).toBeVisible()
    expect(savedText.textContent).toBe(excerpt)
    expect(screen.getByText(/Search, excerpts and citation links do not establish factual accuracy/)).toBeVisible()
    expect(screen.getByText('Not yet reviewed by the author.')).toBeVisible()
  })

  it('renders untrusted excerpt and license text inertly and never activates an unsafe license URL', () => {
    const { container } = render(<ContentAttribution metadata={{ version: 1, references: [{ id: 'source', title: 'Book', excerpt: '<img src=x onerror=bad()>', license_title: '<script>bad()</script>', license_url: 'javascript:bad()' }], review_status: 'unreviewed' }} />)
    fireEvent.click(screen.getByText('查看保存摘录'))
    expect(screen.getByText('<img src=x onerror=bad()>')).toBeVisible()
    expect(screen.getByText('来源许可：<script>bad()</script>')).toBeVisible()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
