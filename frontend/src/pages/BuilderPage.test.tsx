import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { BuilderPage } from './BuilderPage'
import { createExampleProject } from '../data/exampleProject'
import { useProjectStore } from '../store/projectStore'
import { useNodeDraftStore } from '../store/nodeDraftStore'
import { providerConfig, useGenerationJobStore } from '../store/generationJobStore'
import { DEFAULT_MODEL_SETTINGS } from '../store/settingsStore'
import { useLibraryStore } from '../store/libraryStore'
import { api } from '../api/client'

beforeEach(() => { useProjectStore.getState().resetProject(); useNodeDraftStore.setState({ drafts: {} }) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('direct local branch workflow', () => {
  it('adds a page to an untouched example leaf without first editing or saving its content', () => {
    const project = createExampleProject()
    const parentId = project.nodes[project.root_node_id!].children[0]
    const parent = project.nodes[parentId]
    useProjectStore.getState().openProject(project, 'local')
    useProjectStore.getState().navigateTo(parentId)
    render(<MemoryRouter><BuilderPage /></MemoryRouter>)
    const panel = screen.getByRole('region', { name: '分支连接' })
    expect(within(panel).queryByRole('checkbox')).not.toBeInTheDocument()
    fireEvent.click(within(panel).getByRole('button', { name: '添加子页：不只有海洋' }))
    const state = useProjectStore.getState()
    expect(Object.keys(state.project!.nodes)).toHaveLength(5)
    const child = state.project!.nodes[state.activeNodeId!]
    expect(child).toMatchObject({ parent_id: parentId, title: '不只有海洋' })
    expect(state.project!.nodes[parentId].scene_document!.sections[1].target_node_id).toBe(child.id)
    expect(state.project!.nodes[parentId].hotspots[1].id).toBe(parent.scene_document!.sections[1].id)
    expect(screen.getByRole('heading', { level: 1, name: '不只有海洋' })).toBeInTheDocument()
    expect(useNodeDraftStore.getState().drafts[project.project_id]).toBeUndefined()
  })

  it('selects and focuses a virtual section, and exposes its direct branch action', () => {
    const project = createExampleProject()
    const parentId = project.nodes[project.root_node_id!].children[0]
    useProjectStore.getState().openProject(project, 'local')
    useProjectStore.getState().navigateTo(parentId)
    render(<MemoryRouter><BuilderPage /></MemoryRouter>)
    fireEvent.click(within(screen.getByRole('region', { name: '页面画布' })).getByRole('button', { name: '不只有海洋' }))
    const selected = screen.getByRole('group', { name: '内容区块 2：不只有海洋' })
    expect(within(selected).getByRole('textbox', { name: '小标题' })).toHaveFocus()
    expect(within(selected).getByRole('button', { name: '添加子页' })).toBeEnabled()
    fireEvent.change(within(selected).getByRole('textbox', { name: '解释' }), { target: { value: 'unsaved explanation' } })
    expect(within(selected).getByRole('button', { name: '添加子页' })).toBeDisabled()
  })

  it('keeps a visible route to partial-generation warnings from the mobile canvas', () => {
    const project = createExampleProject()
    useProjectStore.getState().openProject(project, 'server')
    useGenerationJobStore.setState({ jobs: {}, references: {}, pending: {}, discovery: {}, checkedRevision: {}, syncing: {} })
    useGenerationJobStore.getState().receive({ job_id: 'partial-job', operation_id: 'operation', project_id: project.project_id,
      node_id: project.root_node_id, kind: 'analyze', phase: 'done', status: 'partial', message: '封面未完成', pct: 100,
      last_event_id: 5, created_at: '2026-10-18', updated_at: '2026-10-18', result: { nodes: [], node_id: project.root_node_id!, warnings: ['缺少封面'] },
      provider_config: providerConfig(DEFAULT_MODEL_SETTINGS), required_credentials: [], confirmation: null, error: null })
    useGenerationJobStore.getState().setDiscovery(project.project_id, 'ready')
    useGenerationJobStore.getState().setSyncing(project.project_id, false)
    render(<MemoryRouter><BuilderPage /></MemoryRouter>)
    expect(screen.getByText('页面已保存，仍有生成提示待查看。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '查看生成提示' }))
    expect(screen.getByText('缺少封面')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '使用当前设置恢复' })).not.toBeInTheDocument()
  })

  it('lets a failed hotspot save reload canonical content through visible history recovery controls', async () => {
    const project = createExampleProject()
    project.revision = 2
    const node = project.nodes[project.root_node_id!]
    node.scene_document = null
    node.hotspots = [{ id: 'image-point', kind: 'image', label: '已保存热点', selected: true, target_node_id: null, position: { x: .2, y: .3 }, size: { width: .2, height: .2 } }]
    const canonical = structuredClone(project)
    canonical.revision = 3
    useProjectStore.getState().openProject(project, 'server')
    useGenerationJobStore.setState({ jobs: {}, references: {}, pending: {}, discovery: {}, checkedRevision: {}, syncing: {} })
    useGenerationJobStore.getState().setDiscovery(project.project_id, 'ready')
    vi.spyOn(api, 'updateHotspots').mockRejectedValue(new Error('保存修订冲突'))
    vi.spyOn(api, 'listPageVersions').mockResolvedValue({ project_revision: 3, current_version_id: null, versions: [] })
    vi.spyOn(api, 'getProject').mockResolvedValue(canonical)
    render(<MemoryRouter><BuilderPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '编辑热点：已保存热点' }))
    const label = screen.getByRole('textbox', { name: '热点名称' })
    fireEvent.change(label, { target: { value: '保存失败的热点' } })
    fireEvent.blur(label)
    await waitFor(() => expect(screen.getAllByText('有修改未同步').length).toBeGreaterThan(0))
    fireEvent.click(screen.getAllByRole('button', { name: '历史版本' })[0])
    const reload = await screen.findByRole('button', { name: '重新载入已保存页面' })
    await waitFor(() => expect(reload).toBeEnabled())
    fireEvent.click(reload)
    await waitFor(() => expect(useProjectStore.getState().project?.revision).toBe(3))
    expect(useProjectStore.getState().project?.nodes[node.id].hotspots[0].label).toBe('已保存热点')
    expect(useLibraryStore.getState().projects[`local-recovery-${project.project_id}`].project.nodes[node.id].hotspots[0].label).toBe('保存失败的热点')
    expect(await screen.findByText('已载入最新保存的作品。请选择版本并重新查看恢复预览。')).toBeVisible()
    expect(screen.queryByText('页面修改尚未成功保存。请先重试保存，再恢复版本。')).not.toBeInTheDocument()
  })
})
