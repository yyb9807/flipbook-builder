/** Immutable work receipts contain no authoring content, history or model settings. */
export interface Publication {
  id: string
  project_id: string
  name: string
  source_revision: number
  created_at: string
  page_count: number
  content_hash: string
  state: 'published' | 'withdrawn'
  url: string
}

export interface PublicationList { publications: Publication[] }
export interface PublicationResult { publication: Publication }
