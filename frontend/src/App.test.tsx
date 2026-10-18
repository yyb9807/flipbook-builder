import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RootRoute } from './App'
import { useProjectStore } from './store/projectStore'
import { providerConfig, useGenerationJobStore } from './store/generationJobStore'
import { DEFAULT_MODEL_SETTINGS } from './store/settingsStore'
import { useCreationStore } from './store/creationStore'
import { createExampleProject } from './data/exampleProject'
import type { GenerationJob } from './types/jobs'

vi.mock('./pages/HomePage', () => ({ HomePage: () => <p>creation-input</p> }))
vi.mock('./pages/BuilderPage', () => ({ BuilderPage: () => <p>editor-page</p> }))
vi.mock('./pages/ViewerPage', () => ({ ViewerPage: () => <p>viewer-page</p> }))
vi.mock('./hooks/useGenerationJobs', () => ({ useGenerationJobs: vi.fn() }))
vi.mock('./api/client', () => ({ api: { cancelGenerationJob: vi.fn(), provideGenerationCredentials: vi.fn() } }))

beforeEach(() => {
  useProjectStore.getState().resetProject()
  useGenerationJobStore.setState({ references: {}, jobs: {}, pending: {}, discovery: {}, connection: {}, syncing: {} })
  useCreationStore.getState().setTopic('my original topic')
})
afterEach(cleanup)

function renderEmpty(status?: GenerationJob['status']) {
  const project = { ...createExampleProject(), root_node_id: null, nodes: {} }
  useProjectStore.getState().openProject(project, 'server')
  useGenerationJobStore.getState().setDiscovery(project.project_id, 'ready')
  if (status) useGenerationJobStore.getState().receive({ kind: 'analyze', job_id: 'j', operation_id: 'op', project_id: project.project_id, node_id: null,
    status, phase: 'plan', message: '', pct: 20, last_event_id: 1, created_at: '', updated_at: '', result: null, error: null, confirmation: null,
    provider_config: providerConfig(DEFAULT_MODEL_SETTINGS), required_credentials: ['llm'] })
  render(<MemoryRouter><RootRoute /></MemoryRouter>)
}

describe('empty-root routing and recovery', () => {
  it.each(['waiting_credentials', 'running', 'cancelled', 'failed'] as const)('shows the task page after reload while root is absent: %s', (status) => {
    renderEmpty(status)
    expect(screen.getByRole('region', { name: '生成任务' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '返回创作输入' })).toBeInTheDocument()
    expect(screen.queryByText('creation-input')).not.toBeInTheDocument()
  })
  it('does not strand an empty project with no job and returns to the kept input', () => {
    renderEmpty()
    expect(screen.getByText('此作品尚无页面或正在运行的任务')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '返回创作输入' }))
    expect(screen.getByText('creation-input')).toBeInTheDocument()
    expect(useCreationStore.getState().topic).toBe('my original topic')
  })
  it('keeps settings navigation available without exposing a preview for an unfinished root', () => {
    renderEmpty('running')
    expect(screen.getByRole('link', { name: '模型设置' })).toHaveAttribute('href', '/settings')
    expect(screen.queryByRole('button', { name: '预览作品' })).not.toBeInTheDocument()
  })
  it('uses the editor again as soon as a valid active root has been adopted', () => {
    useProjectStore.getState().openProject(createExampleProject(), 'server')
    render(<MemoryRouter><RootRoute /></MemoryRouter>)
    expect(screen.getByText('editor-page')).toBeInTheDocument()
  })
})
