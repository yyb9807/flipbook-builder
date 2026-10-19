import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { ProjectActions } from './ProjectActions'
import { useProjectStore } from '../../store/projectStore'
import { ToastHost } from '../shared/Toast'
import type { Project } from '../../types'
import { createOfflineZip, publicationSnapshot } from '../../utils/offlineExport'

vi.mock('../../utils/offlineExport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/offlineExport')>()
  return {
    ...actual,
    publicationSnapshot: vi.fn(actual.publicationSnapshot),
    createOfflineZip: vi.fn(),
  }
})

const SAMPLE_PROJECT: Project = {
  project_id: 'proj_abc', name: '测试项目', root_node_id: null,
  settings: { max_depth: 4, max_hotspots_per_page: 3, visual_style: 'atlas', language: 'zh', apiKey: 'private-key' } as Project['settings'],
  nodes: {},
}

async function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

function openMenu() {
  const trigger = screen.getByRole('button', { name: '导出与分享' })
  fireEvent.click(trigger)
  return trigger
}

describe('ProjectActions publication contract', () => {
  beforeEach(() => {
    useProjectStore.setState({ project: SAMPLE_PROJECT, origin: 'local' })
    vi.clearAllMocks()
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:download')
    globalThis.URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.mocked(createOfflineZip).mockResolvedValue(new Blob(['offline-player'], { type: 'application/zip' }))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('does not render without an open project', () => {
    useProjectStore.setState({ project: null })
    const { container } = render(<ProjectActions />)
    expect(container.firstChild).toBeNull()
  })

  it('offers portable exports for local work without an instance link', () => {
    render(<ProjectActions />)
    const trigger = openMenu()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu', { name: '作品导出' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /导出 JSON/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /导出离线 ZIP/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /复制当前实例预览/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /发布固定版本/ })).not.toBeInTheDocument()
  })

  it('closes the menu when its trigger is pressed again', () => {
    render(<ProjectActions />)
    const trigger = openMenu()
    fireEvent.click(trigger)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('moves focus through menu actions and returns it to the trigger on Escape', async () => {
    render(<ProjectActions />)
    const trigger = openMenu()
    const zip = screen.getByRole('menuitem', { name: /导出离线 ZIP/ })
    const json = screen.getByRole('menuitem', { name: /导出 JSON/ })
    await waitFor(() => expect(zip).toHaveFocus())
    fireEvent.keyDown(zip, { key: 'ArrowDown' })
    expect(json).toHaveFocus()
    fireEvent.keyDown(json, { key: 'ArrowDown' })
    expect(zip).toHaveFocus()
    fireEvent.keyDown(zip, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('exposes the current instance link only for server projects and explains its scope', async () => {
    useProjectStore.setState({ origin: 'server' })
    render(<><ProjectActions /><ToastHost /></>)
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /复制当前实例预览/ }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/v/proj_abc`))
    expect(await screen.findByText('当前实例预览链接已复制。内容会随编辑变化，需要此实例在线。')).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('offers a manual copy fallback when clipboard access is unavailable', async () => {
    useProjectStore.setState({ origin: 'server' })
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('not allowed'))
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('')
    render(<ProjectActions />)
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /复制当前实例预览/ }))
    await waitFor(() => expect(prompt).toHaveBeenCalledWith('复制此链接：', `${window.location.origin}/v/proj_abc`))
  })

  it('downloads the content allowlist as JSON without unknown settings or credentials', async () => {
    render(<ProjectActions />)
    const trigger = openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /导出 JSON/ }))
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1))
    expect(publicationSnapshot).toHaveBeenCalledWith(SAMPLE_PROJECT)
    expect(createOfflineZip).not.toHaveBeenCalled()
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
    const content = await readBlob(blob)
    expect(JSON.parse(content).project_id).toBe('proj_abc')
    expect(content).not.toContain('private-key')
    expect(content).not.toContain('apiKey')
    const anchor = vi.mocked(HTMLAnchorElement.prototype.click).mock.instances[0] as HTMLAnchorElement
    expect(anchor.download).toBe('测试项目.json')
    expect(trigger).toHaveFocus()
  })

  it('packages the in-memory local project into a portable ZIP', async () => {
    render(<ProjectActions />)
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /导出离线 ZIP/ }))
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1))
    expect(createOfflineZip).toHaveBeenCalledWith(SAMPLE_PROJECT)
    expect(publicationSnapshot).not.toHaveBeenCalled()
    expect(URL.createObjectURL).toHaveBeenCalledWith(await vi.mocked(createOfflineZip).mock.results[0].value)
    const anchor = vi.mocked(HTMLAnchorElement.prototype.click).mock.instances[0] as HTMLAnchorElement
    expect(anchor.download).toBe('测试项目.zip')
  })

  it('shows an export error, avoids a broken download and restores the menu trigger', async () => {
    vi.mocked(createOfflineZip).mockRejectedValue(new Error('image unavailable'))
    render(<><ProjectActions /><ToastHost /></>)
    const trigger = openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: /导出离线 ZIP/ }))
    expect(await screen.findByText('导出失败：image unavailable')).toBeInTheDocument()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
