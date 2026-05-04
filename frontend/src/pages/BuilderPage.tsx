import { useProjectStore } from '../store/projectStore'
import { useSettingsStore } from '../store/settingsStore'
import { estimateCost, estimateSeconds } from '../utils/costEstimate'
import { Topbar } from '../components/shared/Topbar'
import { Icon } from '../components/shared/Icon'
import { ProjectActions } from '../components/builder/ProjectActions'
import { ApiKeyWarning } from '../components/shared/ApiKeyWarning'
import { LoadingSpinner } from '../components/shared/LoadingSpinner'
import { useToast } from '../components/shared/Toast'
import { PageCanvas } from '../components/builder/PageCanvas'
import { HotspotPanel } from '../components/builder/HotspotPanel'
import { KeywordPanel } from '../components/builder/KeywordPanel'
import { TreeNav } from '../components/builder/TreeNav'
import { GenerateButton } from '../components/builder/GenerateButton'
import { ChildThumbnails } from '../components/builder/ChildThumbnails'
import { useBuilderActions } from '../hooks/useBuilderActions'

/**
 * 构建器：有项目时的 3 列布局。
 * 顶栏 + Tree 左 / Canvas 中 / HotspotPanel 右。
 */
export function BuilderPage() {
  const project = useProjectStore((s) => s.project)
  const activeNodeId = useProjectStore((s) => s.activeNodeId)
  const generating = useProjectStore((s) => s.generating)
  const genProgress = useProjectStore((s) => s.genProgress)
  const updateHotspot = useProjectStore((s) => s.updateHotspot)
  const navigateInto = useProjectStore((s) => s.navigateInto)
  const keywords = useProjectStore((s) => s.keywords)
  const selectedKeywords = useProjectStore((s) => s.selectedKeywords)
  const toggleKeyword = useProjectStore((s) => s.toggleKeyword)

  const { show: showToast, ToastEl } = useToast()
  const { handleGenerateChildren, handleRegenerate, handleHotspotUpdate, cancelInflight } = useBuilderActions(showToast)

  const imgGenModel = useSettingsStore((s) => s.imgGenModel)
  function buildCostHint(count: number): string {
    const cost = estimateCost({ imgGenModel, imageCount: count })
    const sec = estimateSeconds(imgGenModel, count)
    if (!cost) return `约 ${sec} 秒`
    return `${cost} · 约 ${sec} 秒`
  }

  // BuilderPage 只在 project + activeNodeId 都存在时才渲染（由 App 路由控制）
  if (!project || !activeNodeId) return null
  const activeNode = project.nodes[activeNodeId]
  if (!activeNode) return null

  const selectedCount = activeNode.hotspots.filter((h) => h.selected).length
  const hasChildren = activeNode.children.length > 0

  return (
    <div
      className="animate-page-in"
      style={{
        width: '100%',
        height: '100vh',
        display: 'grid',
        gridTemplateRows: 'auto 1fr',
        background: 'var(--bg)',
        overflow: 'hidden',
      }}
    >
      <div>
        <Topbar projectActions={<ProjectActions />} />
        <ApiKeyWarning />
      </div>

      {/* 3-column builder */}
      <div
        className="animate-fade-in"
        style={{
          display: 'grid',
          gridTemplateColumns: '280px 1fr 320px',
          height: '100%',
          overflow: 'hidden',
          padding: 12,
          gap: 12,
        }}
      >
        {/* LEFT: Tree panel */}
        <div className="animate-slide-up" style={{ animationDelay: '0.05s', minHeight: 0 }}>
          <TreeNav onRegenerate={(id) => handleRegenerate(id)} />
        </div>

        {/* CENTER: Canvas */}
        <div
          className="animate-slide-up"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 0,
            // 内容超出列高时允许滚动（旧版 hidden 会让子缩略图被截掉）
            overflow: 'auto',
            minHeight: 0, // flex 子元素允许收缩，否则 overflow:auto 不生效
            animationDelay: '0.12s',
          }}
        >
          <PageCanvas
            node={activeNode}
            onHotspotUpdate={handleHotspotUpdate}
            onHotspotNavigate={(hs) => hs.target_node_id && navigateInto(hs.target_node_id)}
            onRegenerate={activeNode.depth > 0 ? () => handleRegenerate() : undefined}
          />

          {hasChildren && (
            <ChildThumbnails
              childIds={activeNode.children}
              nodesById={project.nodes}
              onOpen={navigateInto}
              onRegenerate={(id) => handleRegenerate(id)}
            />
          )}
        </div>

        {/* RIGHT: AI panel */}
        <div
          className="animate-slide-up"
          style={{
            background: 'var(--bg-elev)',
            borderRadius: 16,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            boxShadow: 'var(--shadow-card)',
            animationDelay: '0.19s',
          }}
        >
          {/* Hotspot suggestions (scrollable) */}
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            <HotspotPanel
              node={activeNode}
              onHotspotChange={(hs) => updateHotspot(activeNodeId, hs)}
              projectId={project.project_id}
            />
            <KeywordPanel
              keywords={keywords}
              selected={selectedKeywords}
              onToggle={toggleKeyword}
            />
          </div>

          {/* Footer: generate + regen */}
          <div
            style={{
              padding: 12,
              borderTop: '0.5px solid var(--separator)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              flexShrink: 0,
            }}
          >
            {!hasChildren && (
              <GenerateButton
                onClick={handleGenerateChildren}
                loading={generating}
                disabled={selectedCount === 0}
                label={
                  selectedCount > 0
                    ? `生成 ${selectedCount} 个子页面`
                    : '请先勾选热点'
                }
                hint={selectedCount > 0 ? buildCostHint(selectedCount) : undefined}
              />
            )}

            {activeNode.depth > 0 && (
              <button
                onClick={() => handleRegenerate()}
                disabled={generating}
                className="btn btn-sm"
                style={{ flex: 1, justifyContent: 'center', opacity: generating ? 0.5 : 1 }}
              >
                <Icon name="refresh" size={11} />
                重新生成
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Loading overlay for generate */}
      {generating && (
        <LoadingSpinner
          overlay
          steps={['准备生成', '调用页面生成 AI', '生成配图', '保存结果']}
          currentStep={genProgress?.step ?? 0}
          currentPct={genProgress?.pct ?? 5}
          onCancel={cancelInflight}
        />
      )}

      {ToastEl}
    </div>
  )
}
