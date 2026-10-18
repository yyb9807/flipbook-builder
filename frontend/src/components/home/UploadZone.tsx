import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useCreationStore } from '../../store/creationStore'
import { useSettingsStore } from '../../store/settingsStore'
import { useProjectStore } from '../../store/projectStore'
import { createManualProject, createManualImageProject } from '../../data/exampleProject'
import { ImageUploadField } from './ImageUploadField'
import { Icon } from '../shared/Icon'
import { useI18n } from '../../i18n'
import { useCopy } from '../../i18n/workspace'

interface Props { onFile: (file: File, keywords?: string) => void; onText: (text: string, generateImages: boolean) => void; loading: boolean }
export function UploadZone({ onFile, onText, loading }: Props) {
  const draft = useCreationStore()
  const { locale } = useI18n()
  const c = useCopy()
  const llmKey = useSettingsStore((s) => s.llmApiKey)
  const imageKey = useSettingsStore((s) => s.imgGenApiKey)
  const openProject = useProjectStore((s) => s.openProject)
  const [manualBusy, setManualBusy] = useState(false)
  const [manualError, setManualError] = useState('')
  const canSubmit = draft.tab === 'text' ? !!draft.topic.trim() : !!draft.file
  const needsKey = llmKey.trim().length < 8 || (draft.tab === 'text' && draft.generateImages && !imageKey.trim())
  function submit() {
    if (!canSubmit || loading) return
    if (draft.tab === 'text') onText(draft.topic.trim(), draft.generateImages)
    else if (draft.file) onFile(draft.file, draft.keywords.trim() || undefined)
  }
  async function manual() {
    if (manualBusy || !canSubmit) return
    setManualBusy(true)
    setManualError('')
    try {
      const project = draft.tab === 'image' && draft.file ? await createManualImageProject(draft.file, locale) : createManualProject(draft.topic, locale)
      openProject(project, 'local')
      draft.clear()
    } catch (error) { setManualError((error as Error).message) }
    finally { setManualBusy(false) }
  }
  return <div className="creation-form">
    <h2>{c('开始一份新作品', 'Start a new project')}</h2>
    <p className="muted">{c('选一个起点，内容和热点都可以继续调整。', 'Choose a starting point. Refine the content and hotspots as you go.')}</p>
    <div className="segmented-control" aria-label={c('输入方式', 'Starting point')}>
      {(['text', 'image'] as const).map((tab) => <button key={tab} type="button" aria-pressed={draft.tab === tab} onClick={() => draft.setTab(tab)} disabled={loading}>
        <Icon name={tab === 'text' ? 'pen' : 'image'} />{tab === 'text' ? c('从主题开始', 'From a topic') : c('从图片开始', 'From an image')}
      </button>)}
    </div>
    <fieldset disabled={loading} className="creation-fields">
      {draft.tab === 'text' ? <><div className="field">
        <label htmlFor="creation-topic">{c('你想讲解什么？', 'What would you like to explain?')}</label>
        <textarea id="creation-topic" rows={4} maxLength={10000} value={draft.topic} onChange={(e) => draft.setTopic(e.target.value)} placeholder={c('例如：一杯咖啡从种子到杯中的旅程', 'For example: the journey of coffee from seed to cup')} />
        <span className="field-hint">{c('主题文字会保留。可以先手动搭建，再完善内容。', 'Your text is kept. Start manually and refine your content later.')}</span>
      </div><label className="creation-image-option"><input type="checkbox" checked={draft.generateImages} onChange={(event) => draft.setGenerateImages(event.target.checked)} />{c('同时生成插图（可选）', 'Generate an illustration (optional)')}</label><p className="field-hint">{draft.generateImages ? c('另需图片服务，可能产生额外费用；图片失败时保留知识正文。', 'Requires an image provider and may cost extra. Knowledge content is kept if the illustration fails.') : c('先生成可编辑的知识正文，仅需内容模型。', 'Generate editable knowledge content using only a text model.')}</p></> : <>
        <ImageUploadField file={draft.file} onFile={draft.setFile} keywords={draft.keywords} onKeywords={draft.setKeywords} />
        <p className="field-hint">{c('文件仅在本次会话保留，刷新后需要重新选择。', 'The file is kept for this session. Select it again after a refresh.')}</p>
      </>}
    </fieldset>
    <div className="creation-actions">
      <button className="btn" onClick={() => void manual()} disabled={!canSubmit || loading || manualBusy}>{manualBusy ? c('正在准备…', 'Preparing…') : draft.tab === 'text' ? c('手动创建知识页', 'Create manually') : c('手动标注图片', 'Annotate manually')}</button>
      {needsKey ? <Link to="/settings" className="btn btn-primary" aria-disabled={loading} onClick={(e) => { if (loading) e.preventDefault() }}><Icon name="gear" />{c('配置 AI 服务', 'Set up AI')}</Link> :
        <button className="btn btn-primary" onClick={submit} disabled={loading || !canSubmit}><Icon name="spark" />{loading ? c('正在创建…', 'Creating…') : c('用 AI 创建', 'Create with AI')}</button>}
    </div>
    {manualError && <p className="notice-error creation-error" role="alert">{manualError}</p>}
    {needsKey && <p className="creation-note">{c('手动创作和示例无需配置。AI 生成使用你自己的服务与 Key。', 'Manual editing and examples need no setup. AI uses your own provider and key.')}</p>}
  </div>
}
