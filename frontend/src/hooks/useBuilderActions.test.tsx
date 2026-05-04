import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useBuilderActions } from './useBuilderActions'
import { useProjectStore } from '../store/projectStore'
import { useSettingsStore } from '../store/settingsStore'

// Mock api 模块 —— 避免真发 fetch
vi.mock('../api/client', () => ({
  api: {
    createProject: vi.fn(),
    analyzeUploadStream: vi.fn(),
    generateChildrenStream: vi.fn(),
    regenerateNode: vi.fn(),
    updateHotspots: vi.fn(),
    getProject: vi.fn(),
  },
}))

import { api } from '../api/client'

/** 把 SSE 模拟成 async iterable —— 给 streaming API 返回预设事件序列。 */
function makeStream(events: object[]): AsyncIterable<object> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e
    },
  }
}

describe('useBuilderActions', () => {
  let toast: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // 重置所有 store
    useProjectStore.setState({
      project: null,
      activeNodeId: null,
      navigationStack: [],
      analyzing: false,
      generating: false,
      genProgress: null,
      keywords: [],
      selectedKeywords: [],
    })
    useSettingsStore.setState({
      llmApiKey: '',
      llmBaseUrl: 'https://api.x.com',
      llmModel: 'claude-x',
      imgGenApiKey: '',
      imgGenBaseUrl: 'https://api.y.com',
      imgGenModel: 'dall-e-3',
    })
    toast = vi.fn()
    vi.clearAllMocks()
  })

  afterEach(cleanup)

  describe('checkApiKey 守卫', () => {
    it('LLM Key 为空时阻断上传 + 弹错误 toast', async () => {
      const { result } = renderHook(() => useBuilderActions(toast))
      await act(async () => {
        await result.current.handleUpload(undefined, 'hello')
      })
      expect(toast).toHaveBeenCalledWith(
        '请先在设置页填写 LLM API Key',
        'error',
      )
      expect(api.createProject).not.toHaveBeenCalled()
    })

    it('LLM Key 太短（< 8 字符）也阻断', async () => {
      useSettingsStore.setState({ llmApiKey: 'sk-x' })
      const { result } = renderHook(() => useBuilderActions(toast))
      await act(async () => {
        await result.current.handleUpload(undefined, 'hello')
      })
      expect(toast).toHaveBeenCalledWith(
        '请先在设置页填写 LLM API Key',
        'error',
      )
      expect(api.createProject).not.toHaveBeenCalled()
    })

    it('handleGenerateChildren 同样守卫', async () => {
      // 即使有 project，没 key 也应阻断
      useProjectStore.setState({
        project: { project_id: 'p1', name: 'x', root_node_id: 'n1', settings: {} as never, nodes: {} },
        activeNodeId: 'n1',
      })
      const { result } = renderHook(() => useBuilderActions(toast))
      await act(async () => {
        await result.current.handleGenerateChildren()
      })
      expect(toast).toHaveBeenCalledWith(
        '请先在设置页填写 LLM API Key',
        'error',
      )
      expect(api.generateChildrenStream).not.toHaveBeenCalled()
    })
  })

  describe('warnSlowImageModel', () => {
    it('用 gpt-image-2 时提醒慢', async () => {
      useSettingsStore.setState({
        llmApiKey: 'sk-ant-valid-long-key',
        imgGenModel: 'gpt-image-2',
      })
      vi.mocked(api.createProject).mockResolvedValue({
        project_id: 'p1',
        name: 'x',
        settings: {},
      })
      vi.mocked(api.analyzeUploadStream).mockReturnValue(
        makeStream([{ done: true, node_id: 'n1', summary: 's', main_objects: [], scene_type: 'x', image_url: null, source_type: 'text', hotspots: [], keywords: [] }]) as never,
      )

      const { result } = renderHook(() => useBuilderActions(toast))
      await act(async () => {
        await result.current.handleUpload(undefined, 'hello')
      })

      // 第一次 toast 应该是 slow warning（注意此时 key 已填，所以 checkApiKey 不会触发 toast）
      const slowCall = toast.mock.calls.find((c) =>
        typeof c[0] === 'string' && c[0].includes('gpt-image-2'),
      )
      expect(slowCall).toBeTruthy()
      expect(slowCall![1]).toBe('info')
    })

    it('用 dall-e-3 不提醒（不慢）', async () => {
      useSettingsStore.setState({
        llmApiKey: 'sk-ant-valid-long-key',
        imgGenModel: 'dall-e-3',
      })
      vi.mocked(api.createProject).mockResolvedValue({ project_id: 'p1', name: 'x', settings: {} })
      vi.mocked(api.analyzeUploadStream).mockReturnValue(
        makeStream([{ done: true, node_id: 'n1', summary: 's', main_objects: [], scene_type: 'x', image_url: null, source_type: 'text', hotspots: [], keywords: [] }]) as never,
      )

      const { result } = renderHook(() => useBuilderActions(toast))
      await act(async () => {
        await result.current.handleUpload(undefined, 'hello')
      })
      const slowCall = toast.mock.calls.find((c) =>
        typeof c[0] === 'string' && c[0].includes('约'),
      )
      expect(slowCall).toBeFalsy()
    })
  })

  describe('handleUpload 流程', () => {
    beforeEach(() => {
      useSettingsStore.setState({ llmApiKey: 'sk-ant-valid-long-key' })
    })

    it('成功路径：创建项目 → SSE 流 → 设置 store → 成功 toast', async () => {
      vi.mocked(api.createProject).mockResolvedValue({
        project_id: 'p1',
        name: '我的翻翻书',
        settings: { language: 'zh' },
      })
      vi.mocked(api.analyzeUploadStream).mockReturnValue(
        makeStream([
          { step: 0, pct: 8, message: '分析中' },
          {
            done: true,
            node_id: 'n1',
            summary: '一段描述',
            main_objects: ['a', 'b'],
            scene_type: 'place',
            image_url: '/uploads/p1/n1.png',
            source_type: 'text',
            hotspots: [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }],
            keywords: [{ label: 'kw1', description: 'd1' }],
          },
        ]) as never,
      )

      const { result } = renderHook(() => useBuilderActions(toast))
      await act(async () => {
        await result.current.handleUpload(undefined, '一段文字')
      })

      // 项目已设置
      expect(useProjectStore.getState().project?.project_id).toBe('p1')
      // 根节点 ID 设为 active
      expect(useProjectStore.getState().activeNodeId).toBe('n1')
      // analyzing 已重置
      expect(useProjectStore.getState().analyzing).toBe(false)
      // 成功 toast
      expect(toast).toHaveBeenCalledWith('识别到 3 个热点区域', 'success')
    })

    it('上传时如果已经在 analyzing 中，直接返回（不重复触发）', async () => {
      useProjectStore.setState({ analyzing: true })
      const { result } = renderHook(() => useBuilderActions(toast))
      await act(async () => {
        await result.current.handleUpload(undefined, 'hi')
      })
      expect(api.createProject).not.toHaveBeenCalled()
    })

    it('SSE 返回 error 事件 → toast 失败', async () => {
      vi.mocked(api.createProject).mockResolvedValue({ project_id: 'p1', name: 'x', settings: {} })
      vi.mocked(api.analyzeUploadStream).mockReturnValue(
        makeStream([{ error: 'LLM API Key 未配置' }]) as never,
      )

      const { result } = renderHook(() => useBuilderActions(toast))
      await act(async () => {
        await result.current.handleUpload(undefined, 'hi')
      })
      // 错误信息含 "LLM API Key 未配置" → 引导去设置
      expect(toast).toHaveBeenCalledWith(
        '请先在设置页填写 LLM API Key',
        'error',
      )
      expect(useProjectStore.getState().analyzing).toBe(false)
    })

    it('其他后端错误显示通用失败 toast', async () => {
      vi.mocked(api.createProject).mockResolvedValue({ project_id: 'p1', name: 'x', settings: {} })
      vi.mocked(api.analyzeUploadStream).mockReturnValue(
        makeStream([{ error: 'OpenAI rate limit exceeded' }]) as never,
      )

      const { result } = renderHook(() => useBuilderActions(toast))
      await act(async () => {
        await result.current.handleUpload(undefined, 'hi')
      })
      const failCall = toast.mock.calls.find((c) =>
        typeof c[0] === 'string' && c[0].startsWith('分析失败'),
      )
      expect(failCall).toBeTruthy()
      expect(failCall![0]).toContain('rate limit')
    })
  })

  describe('cancelInflight', () => {
    it('未进行任何请求时调用安全（不抛错）', () => {
      const { result } = renderHook(() => useBuilderActions(toast))
      expect(() => result.current.cancelInflight()).not.toThrow()
    })

    it('上传期间调用 cancel 让 abortController 触发', async () => {
      useSettingsStore.setState({ llmApiKey: 'sk-ant-valid-long-key' })
      vi.mocked(api.createProject).mockResolvedValue({ project_id: 'p1', name: 'x', settings: {} })

      let capturedSignal: AbortSignal | undefined
      vi.mocked(api.analyzeUploadStream).mockImplementation(
        ((_pid, _f, _t, _kw, signal) => {
          capturedSignal = signal
          // 返回一个永不结束的流（用 yield 让它确实是 generator，规避 lint）
          return {
            async *[Symbol.asyncIterator]() {
              await new Promise((r) => setTimeout(r, 1000))
              yield {} // 永远不会到这里
            },
          }
        }) as never,
      )

      const { result } = renderHook(() => useBuilderActions(toast))
      const uploadPromise = act(async () => {
        await result.current.handleUpload(undefined, 'hi')
      })
      // 等流启动
      await new Promise((r) => setTimeout(r, 10))
      result.current.cancelInflight()
      await uploadPromise

      expect(capturedSignal?.aborted).toBe(true)
    })
  })

  describe('handleRegenerate', () => {
    beforeEach(() => {
      useSettingsStore.setState({ llmApiKey: 'sk-ant-valid-long-key' })
      useProjectStore.setState({
        project: {
          project_id: 'p1',
          name: 'x',
          root_node_id: 'n1',
          settings: {} as never,
          nodes: {
            n1: {
              id: 'n1',
              parent_id: null,
              depth: 0,
              title: 'Root',
              description: '',
              source_type: 'text',
              image_url: null,
              children: [],
              hotspots: [],
              status: 'generated',
            },
          },
        },
        activeNodeId: 'n1',
      })
    })

    it('成功调用 regenerateNode 并更新 store', async () => {
      vi.mocked(api.regenerateNode).mockResolvedValue({
        id: 'n1',
        title: '新标题',
        description: '新描述',
        image_url: '/uploads/p1/n1.png',
        status: 'generated',
      })

      const { result } = renderHook(() => useBuilderActions(toast))
      await act(async () => {
        await result.current.handleRegenerate()
      })

      expect(api.regenerateNode).toHaveBeenCalledWith('p1', 'n1')
      expect(useProjectStore.getState().project?.nodes.n1.title).toBe('新标题')
      // 成功 toast 包含新标题
      const successCall = toast.mock.calls.find((c) =>
        typeof c[0] === 'string' && c[0].includes('已重新生成'),
      )
      expect(successCall).toBeTruthy()
    })

    it('针对指定 node 重新生成（不是 active）', async () => {
      // 添加另一个节点
      useProjectStore.setState((s) => ({
        project: {
          ...s.project!,
          nodes: {
            ...s.project!.nodes,
            n2: {
              id: 'n2', parent_id: 'n1', depth: 1, title: 'Child',
              description: '', source_type: 'image', image_url: null,
              children: [], hotspots: [], status: 'generated',
            },
          },
        },
      }))
      vi.mocked(api.regenerateNode).mockResolvedValue({
        id: 'n2',
        title: 'X',
        description: '',
        image_url: null,
        status: 'generated',
      })

      const { result } = renderHook(() => useBuilderActions(toast))
      await act(async () => {
        await result.current.handleRegenerate('n2')
      })
      expect(api.regenerateNode).toHaveBeenCalledWith('p1', 'n2')
    })
  })
})
