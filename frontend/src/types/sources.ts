import type { ContentReference } from './index'

export interface SourceCandidate {
  key: string
  page_id: number
  title: string
  snippet: string
  url: string
}

export interface SourceSearchResult {
  provider: 'wikipedia'
  language: 'zh' | 'en'
  query: string
  retrieved_at: string
  candidates: SourceCandidate[]
}

export interface SourcePageResult {
  reference: ContentReference
  truncated: boolean
}
