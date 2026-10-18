import type { FlipNode, Hotspot } from '../../types'
import { SceneEditor } from '../scene/SceneEditor'
import { useI18n } from '../../i18n'
import { useCopy } from '../../i18n/workspace'
import { Icon } from '../shared/Icon'

interface Props {
  node: FlipNode
  selectedHotspotId?: string | null
  onHotspotSelect?: (hotspot: Hotspot) => void
  onHotspotUpdate: (hotspot: Hotspot) => void
  onHotspotNavigate?: (hotspot: Hotspot) => void
  onRegenerate?: () => void
  disabled?: boolean
}
export function PageCanvas({ node, selectedHotspotId, onHotspotSelect, onHotspotUpdate, onHotspotNavigate, onRegenerate, disabled }: Props) {
  const { locale } = useI18n()
  const c = useCopy()
  return <section className="editor-canvas-surface" aria-label={c('页面画布', 'Page canvas')}>
    <div className="canvas-toolbar"><span>{node.scene_document ? c('知识页 · 文字可编辑', 'Knowledge page · editable text') : c('图片场景 · 热点可校正', 'Image scene · adjustable hotspots')}</span>
      {onRegenerate && <button className="text-button" onClick={onRegenerate} title={c('重新生成页面说明和插图；完成前保留原页面', 'Regenerate the page text and image; keep the original until completion')}><Icon name="refresh" />{c('重新生成页面', 'Regenerate page')}</button>}
    </div>
    <fieldset disabled={disabled}><SceneEditor node={node} selectedHotspotId={selectedHotspotId} onHotspotSelect={onHotspotSelect} onHotspotCommit={onHotspotUpdate} onHotspotOpen={onHotspotNavigate} locale={locale} /></fieldset>
    <p className="canvas-hint">{node.scene_document ? c('点选内容区块，即可编辑文字或添加子页。', 'Select a section to edit its text or add a page.') : c('点击选择热点，拖动校正位置；方向键微调，Shift 加速。', 'Select and drag a hotspot. Use arrow keys to adjust, Shift for larger steps.')}</p>
  </section>
}
