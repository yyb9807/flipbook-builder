import { useState } from 'react'
import type { FlipNode, Hotspot } from '../../types'
import { useCopy } from '../../i18n/workspace'
import { Icon } from '../shared/Icon'
import { sectionHotspot } from '../scene/sectionHotspot'

interface Props {
  node: FlipNode; onHotspotChange: (hotspot: Hotspot) => void; selectedId?: string | null;
  local?: boolean; canCreateBranch?: boolean; onSelect?: (hotspot: Hotspot) => void;
  onOpen?: (hotspot: Hotspot) => void; onCreateBranch?: (hotspot: Hotspot) => void;
  onAdd?: () => void; onEditContent?: () => void;
}
export function HotspotPanel({ node, onHotspotChange, selectedId, local = false, canCreateBranch = true, onSelect, onOpen, onCreateBranch, onAdd, onEditContent }: Props) {
  const c = useCopy()
  const hotspots = local && node.scene_document
    ? node.scene_document.sections.map((section, index) => sectionHotspot(node, section, index))
    : node.hotspots
  const linked = hotspots.filter((hotspot) => hotspot.target_node_id).length
  return <section className="hotspot-inspector" aria-labelledby="hotspots-title">
    <div className="panel-heading"><h2 id="hotspots-title">{c('分支连接', 'Branch connections')}</h2><span>{hotspots.length}</span></div>
    <p className="panel-description">{local
      ? c('为每个要点添加子页，让读者继续探索。', 'Connect each idea to a page readers can explore.')
      : node.scene_document ? c('勾选要生成的区块，或直接打开已有分支。', 'Select sections to generate, or open a connected page.') : c('勾选要生成的热点，或直接打开已有分支。', 'Select hotspots to generate, or open a connected page.')}</p>
    {hotspots.length > 0 && <p className="branch-count">{c(`${linked} 个已连接 · ${hotspots.length - linked} 个待连接`, `${linked} connected · ${hotspots.length - linked} to connect`)}</p>}
    {!hotspots.length && <div className="panel-empty">
      <strong>{node.scene_document ? c('先添加一个内容区块', 'Start with a content section') : c('连接下一张页面', 'Connect the next page')}</strong>
      <p>{node.scene_document ? c('每个区块都可以连接一张子页。', 'Each section can connect to its own page.') : node.image_url ? c('在图片上标记一个要讲解的位置，再为它添加分支。', 'Mark a place in the image, then add its branch.') : c('此页暂无插图。可以先编辑说明，或为下一页添加一个分支起点。', 'This page has no illustration. Edit its description or add a starting point for the next page.')}</p>
      {node.scene_document && onEditContent && <button className="text-button" onClick={onEditContent}>{c('编辑页面内容', 'Edit page content')}<Icon name="arrow-right" /></button>}
    </div>}
    {onAdd && <button className="btn btn-sm add-hotspot-button" disabled={hotspots.length >= 12} onClick={onAdd}><Icon name="plus" />{node.image_url ? c('添加手动热点', 'Add a hotspot') : c('添加分支起点', 'Add a starting point')}</button>}
    <div className="hotspot-list">{hotspots.map((hotspot, index) => <HotspotRow key={hotspot.id} hotspot={hotspot} index={index}
      active={selectedId === hotspot.id} local={local} canCreateBranch={canCreateBranch} editableLabel={!node.scene_document && hotspot.kind !== 'section'}
      onChange={onHotspotChange} onSelect={onSelect} onOpen={onOpen} onCreateBranch={onCreateBranch} />)}</div>
    {local && !canCreateBranch && <p className="field-hint branch-save-hint">{c('先保存页面草稿，再添加子页。', 'Save page drafts before adding a page.')}</p>}
  </section>
}
function HotspotRow({ hotspot, index, active, local, canCreateBranch, editableLabel, onChange, onSelect, onOpen, onCreateBranch }: {
  hotspot: Hotspot; index: number; active: boolean; local: boolean; canCreateBranch: boolean; editableLabel: boolean;
  onChange: (h: Hotspot) => void; onSelect?: (h: Hotspot) => void; onOpen?: (h: Hotspot) => void; onCreateBranch?: (h: Hotspot) => void;
}) {
  const c = useCopy()
  const [label, setLabel] = useState(hotspot.label)
  const linked = !!hotspot.target_node_id
  return <div className={'hotspot-row' + (active ? ' active' : '')}>
    <div className="hotspot-row-main">
      {!local && !linked && <label className="hotspot-generation-toggle"><input type="checkbox" aria-label={c('选择 ', 'Select ') + hotspot.label} checked={hotspot.selected} onChange={() => onChange({ ...hotspot, selected: !hotspot.selected })} /></label>}
      <button className="hotspot-select" onClick={() => onSelect?.(hotspot)} aria-pressed={active}
        aria-label={c(editableLabel ? '编辑热点：' : '编辑区块：', editableLabel ? 'Edit hotspot: ' : 'Edit section: ') + hotspot.label}>
        <span className="hotspot-number">{index + 1}</span><span className="hotspot-row-copy"><span>{hotspot.label}</span><span className="hotspot-row-status">{linked ? c('已连接', 'Connected') : local ? c('待添加子页', 'No page yet') : c('待生成', 'Not generated')}</span></span>
      </button>
      {linked ? <button className="branch-row-action" onClick={() => onOpen?.(hotspot)} aria-label={c('打开分支：', 'Open branch: ') + hotspot.label}>{c('打开分支', 'Open')}<Icon name="arrow-right" size={14} /></button>
        : onCreateBranch && <button className="branch-row-action" disabled={!canCreateBranch} onClick={() => onCreateBranch(hotspot)} aria-label={c('添加子页：', 'Add page: ') + hotspot.label}><Icon name="plus" size={14} />{c('添加子页', 'Add page')}</button>}
    </div>
    {active && editableLabel && <div className="hotspot-details"><label className="field">{c('热点名称', 'Hotspot label')}<input value={label} maxLength={100} onChange={(event) => setLabel(event.target.value)} onBlur={() => { if (label.trim() && label.trim() !== hotspot.label) onChange({ ...hotspot, label: label.trim() }) }} /></label></div>}
  </div>
}
