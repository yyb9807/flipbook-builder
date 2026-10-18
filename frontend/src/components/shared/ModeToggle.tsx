import { useProjectStore } from '../../store/projectStore'
import { useCopy } from '../../i18n/workspace'
import { Icon } from './Icon'
import { useNodeDraftStore } from '../../store/nodeDraftStore'

export function ModeToggle() {
  const project = useProjectStore((s) => s.project)
  const mode = useProjectStore((s) => s.mode)
  const busy = useProjectStore((s) => s.generating || s.analyzing)
  const setMode = useProjectStore((s) => s.setMode)
  const c = useCopy()
  const hasDrafts = useNodeDraftStore((s) => Object.keys(s.drafts[project?.project_id ?? ''] ?? {}).length > 0)
  if (!project?.root_node_id) return null
  return <button className="btn btn-primary preview-button" disabled={busy || hasDrafts} title={hasDrafts ? c('请先保存页面草稿', 'Save page drafts first') : undefined} onClick={() => setMode(mode === 'viewer' ? 'builder' : 'viewer')}><Icon name={mode === 'viewer' ? 'pen' : 'arrow-right'} />{mode === 'viewer' ? c('返回编辑', 'Edit') : c('预览作品', 'Preview')}</button>
}
