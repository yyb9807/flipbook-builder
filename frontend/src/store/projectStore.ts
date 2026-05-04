import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Project, FlipNode, Hotspot, Keyword } from '../types'

export interface GenProgress {
  step: number
  pct: number
  message: string
}

interface ProjectState {
  project: Project | null
  activeNodeId: string | null
  mode: 'builder' | 'viewer'
  navigationStack: string[]
  generating: boolean
  analyzing: boolean
  genProgress: GenProgress | null
  keywords: Keyword[]
  selectedKeywords: string[]

  setProject: (p: Project) => void
  resetProject: () => void
  updateNode: (nodeId: string, update: Partial<FlipNode>) => void
  addNode: (node: FlipNode) => void
  updateHotspot: (nodeId: string, hotspot: Hotspot) => void
  setActiveNode: (nodeId: string) => void
  navigateInto: (nodeId: string) => void
  navigateBack: () => void
  navigateTo: (nodeId: string) => void
  setMode: (mode: 'builder' | 'viewer') => void
  setKeywords: (kws: Keyword[]) => void
  toggleKeyword: (label: string) => void
  setGenerating: (v: boolean) => void
  setAnalyzing: (v: boolean) => void
  setGenProgress: (p: GenProgress | null) => void
  getActiveNode: () => FlipNode | null
}

/**
 * 持久化形状 —— 跟 ProjectState 不同：只存轻量字段 + project_id。
 * 详见 partialize / onRehydrateStorage 注释。
 */
interface PersistedShape {
  _projectId: string | null
  activeNodeId: string | null
  navigationStack: string[]
  mode: 'builder' | 'viewer'
  selectedKeywords: string[]
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
  project: null,
  activeNodeId: null,
  mode: 'builder',
  navigationStack: [],
  generating: false,
  analyzing: false,
  genProgress: null,
  keywords: [],
  selectedKeywords: [],

  setProject: (p) => set({ project: p }),

  resetProject: () =>
    set({
      project: null,
      activeNodeId: null,
      navigationStack: [],
      generating: false,
      analyzing: false,
      genProgress: null,
      keywords: [],
      selectedKeywords: [],
    }),

  setKeywords: (kws) => set({ keywords: kws, selectedKeywords: kws.slice(0, 3).map((k) => k.label) }),

  toggleKeyword: (label) =>
    set((state) => ({
      selectedKeywords: state.selectedKeywords.includes(label)
        ? state.selectedKeywords.filter((k) => k !== label)
        : [...state.selectedKeywords, label],
    })),

  updateNode: (nodeId, update) =>
    set((state) => {
      if (!state.project) return {}
      return {
        project: {
          ...state.project,
          nodes: {
            ...state.project.nodes,
            [nodeId]: { ...state.project.nodes[nodeId], ...update },
          },
        },
      }
    }),

  addNode: (node) =>
    set((state) => {
      if (!state.project) return {}
      const nodes = { ...state.project.nodes, [node.id]: node }
      // 更新父节点的 children 列表
      if (node.parent_id && nodes[node.parent_id]) {
        const parent = nodes[node.parent_id]
        if (!parent.children.includes(node.id)) {
          nodes[node.parent_id] = {
            ...parent,
            children: [...parent.children, node.id],
          }
        }
      }
      return { project: { ...state.project, nodes } }
    }),

  updateHotspot: (nodeId, hotspot) =>
    set((state) => {
      if (!state.project) return {}
      const node = state.project.nodes[nodeId]
      if (!node) return {}
      return {
        project: {
          ...state.project,
          nodes: {
            ...state.project.nodes,
            [nodeId]: {
              ...node,
              hotspots: node.hotspots.map((h) =>
                h.id === hotspot.id ? hotspot : h
              ),
            },
          },
        },
      }
    }),

  setActiveNode: (nodeId) => set({ activeNodeId: nodeId }),

  navigateInto: (nodeId) =>
    set((state) => ({
      activeNodeId: nodeId,
      navigationStack: [...state.navigationStack, nodeId],
    })),

  navigateBack: () =>
    set((state) => {
      const stack = [...state.navigationStack]
      stack.pop()
      const activeNodeId = stack[stack.length - 1] ?? state.project?.root_node_id ?? null
      return { navigationStack: stack, activeNodeId }
    }),

  navigateTo: (nodeId) =>
    set((state) => {
      const stack = [...state.navigationStack]
      const idx = stack.indexOf(nodeId)
      const newStack = idx >= 0 ? stack.slice(0, idx + 1) : [...stack, nodeId]
      return { navigationStack: newStack, activeNodeId: nodeId }
    }),

  setMode: (mode) => set({ mode }),
  setGenerating: (v) => set({ generating: v }),
  setAnalyzing: (v) => set({ analyzing: v }),
  setGenProgress: (p) => set({ genProgress: p }),

  getActiveNode: () => {
    const { project, activeNodeId } = get()
    if (!project || !activeNodeId) return null
    return project.nodes[activeNodeId] ?? null
  },
    }),
    {
      name: 'flipbook-project',
      storage: createJSONStorage(() => localStorage),
      // 只持久化「位置 / 选择」相关的轻量状态。
      // project 整体不存（避免大项目撑爆 localStorage 5MB 配额）—— 改为存 project_id，
      // 刷新时 onRehydrateStorage 异步从 API 拉完整数据。
      partialize: (state): PersistedShape => ({
        _projectId: state.project?.project_id ?? null,
        activeNodeId: state.activeNodeId,
        navigationStack: state.navigationStack,
        mode: state.mode,
        selectedKeywords: state.selectedKeywords,
      }),
      // 反序列化后异步从 API 拉项目数据
      onRehydrateStorage: () => (rehydrated) => {
        // rehydrated 是 partialize 的输出形状，不是完整 ProjectState
        const pid = (rehydrated as PersistedShape | undefined)?._projectId
        if (!pid) return
        // 动态 import 避免循环依赖（store ← api ← settingsStore ← store）
        import('../api/client').then(({ api }) => {
          api
            .getProject(pid)
            .then((proj) => {
              useProjectStore.setState({ project: proj as Project })
            })
            .catch(() => {
              // 项目可能已被删除，清掉过期状态
              useProjectStore.setState({
                project: null,
                activeNodeId: null,
                navigationStack: [],
              })
            })
        })
      },
      version: 2,
    },
  ),
)
