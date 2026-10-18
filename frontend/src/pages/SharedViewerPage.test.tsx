import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SharedViewerPage } from './SharedViewerPage'
import { useProjectStore } from '../store/projectStore'
import type { Project } from '../types'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('read-only shared viewer isolation', () => {
  it('loads a shared project without replacing the open editing workspace or sending model keys', async () => {
    const workspace: Project = { project_id: 'editing', name: '正在编辑', root_node_id: null, settings: { language: 'zh', visual_style: 'atlas', max_depth: 4, max_hotspots_per_page: 3 }, nodes: {} }
    useProjectStore.setState({ project: workspace, activeNodeId: null, mode: 'builder' })
    const shared: Project = {
      ...workspace, project_id: 'shared', name: '共享作品', root_node_id: 'shared-root',
      nodes: { 'shared-root': { id: 'shared-root', parent_id: null, depth: 0, title: '读者看到的页面', description: '只读内容', source_type: 'text', image_url: null, hotspots: [], children: [], status: 'completed' } },
    }
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => shared })
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter initialEntries={['/v/shared']}><Routes><Route path="/v/:projectId" element={<SharedViewerPage />} /></Routes></MemoryRouter>)
    expect(await screen.findByRole('heading', { level: 1, name: '读者看到的页面' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '返回编辑' })).not.toBeInTheDocument()
    expect(useProjectStore.getState().project).toBe(workspace)
    expect(useProjectStore.getState().mode).toBe('builder')
    const options = fetch.mock.calls[0][1]
    expect(options.headers).toBeUndefined()
    expect(fetch.mock.calls[0][0]).toBe('/api/projects/shared')
  })
})
