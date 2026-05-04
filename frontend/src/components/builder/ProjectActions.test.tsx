import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { ProjectActions } from './ProjectActions'
import { useProjectStore } from '../../store/projectStore'
import { ToastHost } from '../shared/Toast'

// Mock api 模块
vi.mock('../../api/client', () => ({
  api: {
    exportProjectJson: vi.fn(),
    exportProjectZip: vi.fn(),
  },
}))

import { api } from '../../api/client'

// Mock window.location for share link
Object.defineProperty(window, 'location', {
  value: { origin: 'http://localhost:3000' },
  writable: true,
})

// Mock createObjectURL（jsdom 不实现）
beforeEach(() => {
  global.URL.createObjectURL = vi.fn(() => 'blob:fake')
  global.URL.revokeObjectURL = vi.fn()
})

const SAMPLE_PROJECT = {
  project_id: 'proj_abc',
  name: '测试项目',
  root_node_id: null,
  settings: {} as never,
  nodes: {},
}

describe('ProjectActions', () => {
  beforeEach(() => {
    useProjectStore.setState({ project: SAMPLE_PROJECT })
    vi.clearAllMocks()
  })
  afterEach(cleanup)

  it('无项目时不渲染', () => {
    useProjectStore.setState({ project: null })
    const { container } = render(<ProjectActions />)
    expect(container.firstChild).toBeNull()
  })

  it('点击「分享」按钮打开下拉菜单', async () => {
    render(<ProjectActions />)
    const trigger = screen.getByText('分享')
    fireEvent.click(trigger)
    expect(await screen.findByText('复制分享链接')).toBeInTheDocument()
    expect(screen.getByText('导出 JSON')).toBeInTheDocument()
    expect(screen.getByText('导出离线 ZIP')).toBeInTheDocument()
  })

  it('再次点击「分享」关闭菜单', async () => {
    render(<ProjectActions />)
    const trigger = screen.getByText('分享')
    fireEvent.click(trigger)
    await screen.findByText('复制分享链接')
    fireEvent.click(trigger)
    await waitFor(() => {
      expect(screen.queryByText('复制分享链接')).not.toBeInTheDocument()
    })
  })

  it('复制分享链接 → 写入剪贴板 + toast', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    render(
      <>
        <ProjectActions />
        <ToastHost />
      </>,
    )
    fireEvent.click(screen.getByText('分享'))
    fireEvent.click(await screen.findByText('复制分享链接'))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('http://localhost:3000/v/proj_abc')
    })
    expect(await screen.findByText(/分享链接已复制/)).toBeInTheDocument()
  })

  it('剪贴板 API 失败时降级到 prompt', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('not allowed')) },
      configurable: true,
    })
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('')

    render(<ProjectActions />)
    fireEvent.click(screen.getByText('分享'))
    fireEvent.click(await screen.findByText('复制分享链接'))

    await waitFor(() => {
      expect(promptSpy).toHaveBeenCalledWith(
        '复制此链接：',
        'http://localhost:3000/v/proj_abc',
      )
    })
    promptSpy.mockRestore()
  })

  it('导出 JSON → 调用 api 并触发下载', async () => {
    vi.mocked(api.exportProjectJson).mockResolvedValue({ project_id: 'proj_abc' })

    render(<ProjectActions />)
    fireEvent.click(screen.getByText('分享'))
    fireEvent.click(await screen.findByText('导出 JSON'))

    await waitFor(() => {
      expect(api.exportProjectJson).toHaveBeenCalledWith('proj_abc')
    })
  })

  it('导出 ZIP → 调用 api 并触发下载', async () => {
    vi.mocked(api.exportProjectZip).mockResolvedValue(
      new Blob(['fake'], { type: 'application/zip' }),
    )

    render(<ProjectActions />)
    fireEvent.click(screen.getByText('分享'))
    fireEvent.click(await screen.findByText('导出离线 ZIP'))

    await waitFor(() => {
      expect(api.exportProjectZip).toHaveBeenCalledWith('proj_abc')
    })
  })

  it('导出失败 → 错误 toast', async () => {
    vi.mocked(api.exportProjectJson).mockRejectedValue(new Error('network down'))

    render(
      <>
        <ProjectActions />
        <ToastHost />
      </>,
    )
    fireEvent.click(screen.getByText('分享'))
    fireEvent.click(await screen.findByText('导出 JSON'))

    expect(await screen.findByText(/导出失败.*network down/)).toBeInTheDocument()
  })
})
