import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { HomePage } from './pages/HomePage'
import { BuilderPage } from './pages/BuilderPage'
import { ViewerPage } from './pages/ViewerPage'
import { SettingsPage } from './pages/SettingsPage'
import { SharedViewerPage } from './pages/SharedViewerPage'
import { AboutPage } from './pages/AboutPage'
import { useProjectStore } from './store/projectStore'
import { ErrorBoundary } from './components/shared/ErrorBoundary'
import { ToastHost } from './components/shared/Toast'
import { ConfirmHost } from './components/shared/ConfirmDialog'

/**
 * 根路由 "/"：根据 store 状态在 3 个页面间切换（URL 不变）：
 *   - mode === 'viewer' → ViewerPage
 *   - 有 project + activeNode → BuilderPage（3 列编辑器）
 *   - 否则 → HomePage（首页/dashboard）
 */
function RootRoute() {
  const mode = useProjectStore((s) => s.mode)
  const project = useProjectStore((s) => s.project)
  const activeNodeId = useProjectStore((s) => s.activeNodeId)

  if (mode === 'viewer') return <ViewerPage />
  if (project && activeNodeId) return <BuilderPage />
  return <HomePage />
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<RootRoute />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/about" element={<AboutPage />} />
          {/* 分享链接：只读 viewer，从 URL 加载指定项目 */}
          <Route path="/v/:projectId" element={<SharedViewerPage />} />
          {/* 显式重定向旧路径（已废弃，统一到根路径） */}
          <Route path="/home" element={<Navigate to="/" replace />} />
          <Route path="/builder" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      {/* 全局 Toast / Confirm Host —— 单 portal，整个 App 共用 */}
      <ToastHost />
      <ConfirmHost />
    </ErrorBoundary>
  )
}
