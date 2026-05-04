import { useRef } from 'react'
import { useProjectStore } from '../store/projectStore'
import { useSettingsStore } from '../store/settingsStore'
import { api } from '../api/client'
import { findImageModel } from '../utils/llmProviders'
import type { Hotspot, Project, FlipNode } from '../types'
import type {
  AnalyzeStreamDone,
  CreateProjectResponse,
  GenChildrenStreamDone,
  RegenerateResponse,
} from '../types/api'

type ToastFn = (msg: string, type?: 'success' | 'error' | 'info') => void

const PROJECT_NAME_DEFAULT = '我的翻翻书'

/**
 * 项目核心操作的 hook：上传分析 / 生成子节点 / 重新生成 / 更新热点。
 * 所有 handler 都从 zustand store 直接拿状态和 setter，调用方只需要传 toast。
 */
export function useBuilderActions(showToast: ToastFn) {
  const project = useProjectStore((s) => s.project)
  const activeNodeId = useProjectStore((s) => s.activeNodeId)
  const analyzing = useProjectStore((s) => s.analyzing)
  const generating = useProjectStore((s) => s.generating)

  // 当前进行中的 AbortController（用于"取消生成"按钮）
  const abortRef = useRef<AbortController | null>(null)
  function cancelInflight() {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
  }
  const selectedKeywords = useProjectStore((s) => s.selectedKeywords)
  const setProject = useProjectStore((s) => s.setProject)
  const setActiveNode = useProjectStore((s) => s.setActiveNode)
  const navigateInto = useProjectStore((s) => s.navigateInto)
  const setKeywords = useProjectStore((s) => s.setKeywords)
  const updateNode = useProjectStore((s) => s.updateNode)
  const addNode = useProjectStore((s) => s.addNode)
  const updateHotspot = useProjectStore((s) => s.updateHotspot)
  const setAnalyzing = useProjectStore((s) => s.setAnalyzing)
  const setGenerating = useProjectStore((s) => s.setGenerating)
  const setGenProgress = useProjectStore((s) => s.setGenProgress)

  function checkApiKey(): boolean {
    const key = useSettingsStore.getState().llmApiKey
    if (!key || key.trim().length < 8) {
      showToast('请先在设置页填写 LLM API Key', 'error')
      return false
    }
    return true
  }

  /** 提醒用户当前图片模型偏慢；不阻断流程，只是 warning。 */
  function warnSlowImageModel() {
    const model = findImageModel(useSettingsStore.getState().imgGenModel)
    if (model?.slow && model.seconds) {
      showToast(
        `${model.id} 单张图约 ${Math.round(model.seconds / 60)} 分钟。建议在设置页切换到更快的模型`,
        'info',
      )
    }
  }

  async function handleUpload(file?: File, text?: string, keywords?: string) {
    if (analyzing) return
    if (!checkApiKey()) return
    warnSlowImageModel()

    const controller = new AbortController()
    abortRef.current = controller
    setAnalyzing(true)
    setGenProgress({ step: 0, pct: 5, message: '初始化项目' })
    try {
      let proj = project
      if (!proj) {
        const created = (await api.createProject(PROJECT_NAME_DEFAULT, {
          max_depth: 4,
          max_hotspots_per_page: 3,
          visual_style: 'encyclopedia',
          language: 'zh',
        })) as CreateProjectResponse
        proj = {
          project_id: created.project_id,
          name: created.name,
          root_node_id: null,
          settings: created.settings as Project['settings'],
          nodes: {},
        }
        setProject(proj)
      }

      let result: AnalyzeStreamDone | null = null
      for await (const ev of api.analyzeUploadStream(proj.project_id, file, text, keywords, controller.signal)) {
        if (ev.error) throw new Error(ev.error as string)
        if (ev.done) {
          result = ev as unknown as AnalyzeStreamDone
        } else if (ev.step !== undefined) {
          setGenProgress({
            step: ev.step as number,
            pct: ev.pct as number,
            message: ev.message as string,
          })
        }
      }

      if (!result) throw new Error('未收到分析结果')

      const rootNode: FlipNode = {
        id: result.node_id,
        parent_id: null,
        depth: 0,
        title: result.summary.slice(0, 30),
        description: result.summary,
        source_type: result.source_type,
        image_url: result.image_url,
        children: [],
        hotspots: result.hotspots,
        status: 'draft',
      }
      const updatedProject: Project = {
        ...proj,
        root_node_id: result.node_id,
        nodes: { [result.node_id]: rootNode },
      }
      setProject(updatedProject)
      setActiveNode(result.node_id)
      navigateInto(result.node_id)
      setKeywords(result.keywords ?? [])
      showToast(`识别到 ${result.hotspots.length} 个热点区域`, 'success')
    } catch (e) {
      const msg = (e as Error).message
      if (controller.signal.aborted || msg.includes('aborted') || msg.includes('AbortError')) {
        showToast('已取消', 'info')
      } else if (msg.includes('LLM API Key 未配置')) {
        showToast('请先在设置页填写 LLM API Key', 'error')
      } else {
        showToast(`分析失败：${msg}`, 'error')
      }
    } finally {
      abortRef.current = null
      setAnalyzing(false)
      setGenProgress(null)
    }
  }

  async function handleGenerateChildren() {
    if (!project || !activeNodeId || generating) return
    if (!checkApiKey()) return
    warnSlowImageModel()

    const controller = new AbortController()
    abortRef.current = controller
    setGenerating(true)
    setGenProgress({ step: 0, pct: 5, message: '准备生成' })
    try {
      let result: GenChildrenStreamDone | null = null
      for await (const ev of api.generateChildrenStream(
        project.project_id,
        activeNodeId,
        selectedKeywords,
        controller.signal,
      )) {
        if (ev.error) throw new Error(ev.error as string)
        if (ev.done) {
          result = ev as unknown as GenChildrenStreamDone
        } else if (ev.step !== undefined) {
          setGenProgress({
            step: ev.step as number,
            pct: ev.pct as number,
            message: ev.message as string,
          })
        }
      }

      if (!result) throw new Error('未收到生成结果')

      for (const n of result.nodes) {
        const newNode: FlipNode = {
          id: n.id,
          parent_id: n.parent_id,
          depth: n.depth,
          title: n.title,
          description: n.description,
          source_type: 'image',
          image_url: n.image_url,
          children: [],
          hotspots: n.hotspots ?? [],
          status: 'generated',
        }
        addNode(newNode)
        const node = project.nodes[activeNodeId]
        const hs = node?.hotspots.find((h) => h.id === n.hotspot_id)
        if (hs) updateHotspot(activeNodeId, { ...hs, target_node_id: n.id })
      }

      const fresh = (await api.getProject(project.project_id)) as Project
      setProject(fresh)
      updateNode(activeNodeId, { status: 'completed' })
      showToast(`成功生成 ${result.nodes.length} 个子页面`, 'success')
    } catch (e) {
      const msg = (e as Error).message
      if (controller.signal.aborted || msg.includes('aborted') || msg.includes('AbortError')) {
        showToast('已取消', 'info')
      } else {
        showToast(`生成失败：${msg}`, 'error')
      }
    } finally {
      abortRef.current = null
      setGenerating(false)
      setGenProgress(null)
    }
  }

  /**
   * 重新生成单个页面。
   * @param targetNodeId - 不传则用 activeNodeId（当前页）。
   *   传 id 可针对树里任意节点（如缩略图、TreeNav 上的某行）单独重做。
   */
  async function handleRegenerate(targetNodeId?: string) {
    if (!project || generating) return
    const nodeId = targetNodeId ?? activeNodeId
    if (!nodeId) return
    if (!checkApiKey()) return
    warnSlowImageModel()

    const targetNode = project.nodes[nodeId]
    const label = targetNode?.title || nodeId
    setGenerating(true)
    showToast(`正在重新生成「${label}」…`, 'info')
    try {
      const result = (await api.regenerateNode(project.project_id, nodeId)) as RegenerateResponse
      updateNode(nodeId, {
        title: result.title,
        description: result.description,
        image_url: result.image_url,
      })
      showToast(`「${result.title || label}」已重新生成`, 'success')
    } catch (e) {
      showToast(`重新生成失败：${(e as Error).message}`, 'error')
    } finally {
      setGenerating(false)
    }
  }

  function handleHotspotUpdate(hotspot: Hotspot) {
    if (!activeNodeId) return
    updateHotspot(activeNodeId, hotspot)
    if (project) {
      api
        .updateHotspots(project.project_id, activeNodeId, [
          {
            id: hotspot.id,
            pos_x: hotspot.position.x,
            pos_y: hotspot.position.y,
            width: hotspot.size.width,
            height: hotspot.size.height,
          },
        ])
        .catch((e) => showToast(`热点位置保存失败：${(e as Error).message}`, 'error'))
    }
  }

  return {
    handleUpload,
    handleGenerateChildren,
    handleRegenerate,
    handleHotspotUpdate,
    cancelInflight,
  }
}
