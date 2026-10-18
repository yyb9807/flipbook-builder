import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { GenerationJobPanel } from './GenerationJobPanel'
import { ConfirmHost } from '../shared/ConfirmDialog'
import { projectGenerationLocked, providerConfig, useGenerationJobStore } from '../../store/generationJobStore'
import { DEFAULT_MODEL_SETTINGS, useSettingsStore } from '../../store/settingsStore'
import type { GenerationJob } from '../../types/jobs'

vi.mock('../../api/client', () => ({ api: { provideGenerationCredentials: vi.fn(), retryGenerationJob: vi.fn(), acceptGenerationJob: vi.fn(), cancelGenerationJob: vi.fn() } }))
import { api } from '../../api/client'

function snapshot(status: GenerationJob['status']): GenerationJob {
  return { job_id: 'j', operation_id: 'o', project_id: 'p', node_id: 'n', status, phase: 'image', message: '', pct: 40, last_event_id: 5,
    created_at: '2026-10-18', updated_at: '2026-10-18', result: null, error: null, provider_config: providerConfig(DEFAULT_MODEL_SETTINGS), required_credentials: ['llm', 'imggen'],
    confirmation: status === 'waiting_confirmation' ? { id: 'confirmation', stage: 'image', hotspot_id: 'h', message: '图片结果尚未确认', can_accept: true, accept_label: '保留文字，跳过图片' } : null }
}
function mount(job: GenerationJob) {
  useGenerationJobStore.getState().receive(job)
  return render(<MemoryRouter><GenerationJobPanel projectId="p" /><ConfirmHost /></MemoryRouter>)
}
beforeEach(() => {
  vi.clearAllMocks()
  useGenerationJobStore.setState({ jobs: {}, references: {}, pending: {}, discovery: { p: 'ready' }, connection: {}, syncing: {}, submitting: {}, refreshRevision: 0 })
  useSettingsStore.setState({ ...DEFAULT_MODEL_SETTINGS, llmApiKey: 'fake-llm-key', imgGenApiKey: 'fake-image-key' })
})
afterEach(cleanup)

describe('generation recovery actions', () => {
  it('only sends keys after an explicit resume action and rejects mismatched providers', async () => {
    const job = snapshot('waiting_credentials')
    vi.mocked(api.provideGenerationCredentials).mockResolvedValue({ ...job, status: 'running', last_event_id: 6 })
    mount(job)
    expect(api.provideGenerationCredentials).not.toHaveBeenCalled()
    act(() => useSettingsStore.getState().updateSettings({ imgGenBaseUrl: 'https://other.example/v1' }))
    expect(screen.getByRole('button', { name: '使用当前设置恢复' })).toBeDisabled()
    act(() => useSettingsStore.setState({ ...DEFAULT_MODEL_SETTINGS, llmApiKey: 'fake-llm-key', imgGenApiKey: 'fake-image-key' }))
    fireEvent.click(screen.getByRole('button', { name: '使用当前设置恢复' }))
    await waitFor(() => expect(api.provideGenerationCredentials).toHaveBeenCalledWith('j', expect.objectContaining({ llmApiKey: 'fake-llm-key' })))
  })
  it('requires a separate explicit billing confirmation before retrying an unknown call', async () => {
    const job = snapshot('waiting_confirmation')
    vi.mocked(api.retryGenerationJob).mockResolvedValue({ ...job, status: 'queued', last_event_id: 6 })
    mount(job)
    fireEvent.click(screen.getByRole('button', { name: '重新调用，可能再次计费' }))
    const dialog = await screen.findByRole('dialog')
    expect(api.retryGenerationJob).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('button', { name: '暂不重试' })).toHaveFocus()
    fireEvent.click(within(dialog).getByRole('button', { name: '重新调用，可能再次计费' }))
    await waitFor(() => expect(api.retryGenerationJob).toHaveBeenCalledWith('j', 'confirmation'))
  })
  it('offers the supported accept path without repeating the unknown provider call', async () => {
    const job = snapshot('waiting_confirmation')
    vi.mocked(api.acceptGenerationJob).mockResolvedValue({ ...job, status: 'queued', last_event_id: 6 })
    mount(job)
    fireEvent.click(screen.getByRole('button', { name: '保留文字，跳过图片' }))
    await waitFor(() => expect(api.acceptGenerationJob).toHaveBeenCalledWith('j', 'confirmation'))
    expect(api.retryGenerationJob).not.toHaveBeenCalled()
    expect(api.provideGenerationCredentials).not.toHaveBeenCalled()
  })
  it('keeps the workspace locked after requesting cancellation until the server reports a terminal state', async () => {
    const job = snapshot('running')
    vi.mocked(api.cancelGenerationJob).mockResolvedValue({ ...job, status: 'cancelling', last_event_id: 6 })
    mount(job)
    fireEvent.click(screen.getByRole('button', { name: '取消任务' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '等待取消完成…' })).toBeDisabled())
    expect(projectGenerationLocked(useGenerationJobStore.getState(), 'p', 'server')).toBe(true)
    expect(api.cancelGenerationJob).toHaveBeenCalledTimes(1)
  })
  it('hides unsupported retry and accept actions for an unrecoverable executor error', () => {
    const job = snapshot('waiting_confirmation')
    job.confirmation = { ...job.confirmation!, can_retry: false, can_accept: false }
    mount(job)
    expect(screen.queryByRole('button', { name: '重新调用，可能再次计费' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保留文字，跳过图片' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消任务' })).toBeEnabled()
  })
  it('does not claim regeneration created a new page and keeps cancellation copy accurate', () => {
    const job = { ...snapshot('cancelled'), kind: 'regenerate' as const, result: { nodes: [], warnings: [] } }
    mount(job)
    expect(screen.getByText('原页面仍然保留，可在核对任务后重新发起。')).toBeInTheDocument()
    expect(screen.queryByText('原页面已更新，页面编号与导航保持不变。')).not.toBeInTheDocument()
    expect(screen.queryByText(/个新页面/)).not.toBeInTheDocument()
  })
  it('keeps a successful result compact and expands its original details on demand', async () => {
    const job = { ...snapshot('succeeded'), kind: 'regenerate' as const, message: '已完成页面规划和保存', result: { nodes: [], id: 'n', title: 'updated' } }
    mount(job)
    expect(screen.getByText('页面已更新')).toBeVisible()
    expect(screen.getByText('原页面已更新，页面编号与导航保持不变。')).not.toBeVisible()
    expect(screen.getByText('已完成页面规划和保存')).not.toBeVisible()
    expect(screen.getByRole('button', { name: '重新查询状态' })).not.toBeVisible()
    expect(screen.queryByText(/个新页面/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByText('查看任务详情'))
    expect(screen.getByText('原页面已更新，页面编号与导航保持不变。')).toBeVisible()
    expect(screen.getByText('已完成页面规划和保存')).toBeVisible()
    expect(screen.getByRole('button', { name: '重新查询状态' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '重新查询状态' }))
    expect(useGenerationJobStore.getState().refreshRevision).toBe(1)
  })
  it('keeps partial results and their recovery explanation outside collapsed details', () => {
    const job = { ...snapshot('partial'), message: '部分分支未完成', result: { nodes: [], warnings: ['图片服务拒绝请求，文字已保留。'] }, error: { code: 'partial', message: '两个分支仍待生成。' } }
    mount(job)
    expect(screen.getByText('部分分支未完成')).toBeVisible()
    expect(screen.getByText('图片服务拒绝请求，文字已保留。')).toBeVisible()
    expect(screen.getByText('两个分支仍待生成。')).toBeVisible()
    expect(screen.getByText('已有页面会保留。可继续选择尚无子页的热点再生成。')).toBeVisible()
    expect(screen.getByRole('button', { name: '重新查询状态' })).toBeVisible()
    expect(screen.queryByText('查看任务详情')).not.toBeInTheDocument()
  })
  it('keeps a warning visible even if a server marks a job successful', () => {
    mount({ ...snapshot('succeeded'), result: { nodes: [], warnings: ['热点需要人工校正。'] } })
    expect(screen.getByText('热点需要人工校正。')).toBeVisible()
  })
  it('keeps the failed empty-root cause visible with an input recovery path', () => {
    const job = { ...snapshot('failed'), kind: 'analyze' as const, node_id: null, message: '无法创建第一页', error: { code: 'rejected', message: '内容服务拒绝了请求，请检查模型配置。' } }
    useGenerationJobStore.getState().receive(job)
    render(<MemoryRouter><GenerationJobPanel projectId="p" emptyRoot /></MemoryRouter>)
    expect(screen.getByText('无法创建第一页')).toBeVisible()
    expect(screen.getByText('内容服务拒绝了请求，请检查模型配置。')).toBeVisible()
    expect(screen.getByText('尚未创建页面，可返回创作输入调整后新建作品。')).toBeVisible()
    expect(screen.queryByText('此作品尚无页面或正在运行的任务')).not.toBeInTheDocument()
  })
  it.each(['waiting_credentials', 'waiting_confirmation'] as const)('keeps %s recovery controls immediately visible', (status) => {
    mount(snapshot(status))
    expect(screen.getByRole('button', { name: '取消任务' })).toBeVisible()
    expect(screen.getByRole('button', { name: status === 'waiting_credentials' ? '使用当前设置恢复' : '重新调用，可能再次计费' })).toBeVisible()
    expect(screen.queryByText('查看任务详情')).not.toBeInTheDocument()
  })
  it('does not offer accepting an unknown regeneration image result', () => {
    const job = { ...snapshot('waiting_confirmation'), kind: 'regenerate' as const }
    job.confirmation = { ...job.confirmation!, can_accept: false }
    mount(job)
    expect(screen.queryByRole('button', { name: '保留文字，跳过图片' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消任务' })).toBeEnabled()
  })
})
