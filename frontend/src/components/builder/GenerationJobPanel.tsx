import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import { currentProjectJob, matchesJobSettings, useGenerationJobStore } from '../../store/generationJobStore'
import { useSettingsStore } from '../../store/settingsStore'
import { isTerminalJob, type GenerationJob } from '../../types/jobs'
import { useCopy } from '../../i18n/workspace'
import { confirm } from '../shared/ConfirmDialog'
import { attachPendingUpload, pendingUploadFile, submitGeneration } from '../../hooks/generationJobs'

export function GenerationJobPanel({ projectId, emptyRoot = false }: { projectId: string; emptyRoot?: boolean }) {
  const c = useCopy()
  const job = useGenerationJobStore((state) => currentProjectJob(state, projectId))
  const pending = useGenerationJobStore((state) => state.pending[projectId])
  const discovery = useGenerationJobStore((state) => state.discovery[projectId])
  const connection = useGenerationJobStore((state) => state.connection[projectId])
  const syncing = useGenerationJobStore((state) => state.syncing[projectId])
  const submitting = useGenerationJobStore((state) => state.submitting[projectId])
  const settings = useSettingsStore()
  const [action, setAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attachedOperation, setAttachedOperation] = useState<string | null>(null)
  const inputId = useId()
  async function run(name: string, operation: () => Promise<GenerationJob | void>) {
    if (action) return
    setAction(name)
    setError(null)
    try {
      const snapshot = await operation()
      if (snapshot) useGenerationJobStore.getState().receive(snapshot)
      useGenerationJobStore.getState().refresh()
    } catch { setError(c('操作未确认。请查询状态后再操作，任务与已完成页面仍保留。', 'The action was not confirmed. Refresh the status before trying again. Completed pages are kept.')) }
    finally { setAction(null) }
  }
  async function retry() {
    if (!job?.confirmation) return
    const confirmationId = job.confirmation.id
    const accepted = await confirm({ title: c('确认重新调用服务？', 'Call the provider again?'), message: c('上一次调用的结果尚不确定，可能已经成功并计费。请先在供应商端核实；继续会重新调用，可能再次计费。', 'The previous call may have succeeded and been billed. Check with the provider first. Continuing makes a new call and may incur another charge.'), confirmText: c('重新调用，可能再次计费', 'Call again · may be billed again'), cancelText: c('暂不重试', 'Keep waiting') })
    if (accepted) await run('retry', () => api.retryGenerationJob(job.job_id, confirmationId))
  }
  const matching = !job || matchesJobSettings(job.provider_config, settings)
  const hasKeys = !job || job.required_credentials.every((kind) => kind === 'llm' ? Boolean(settings.llmApiKey.trim()) : Boolean(settings.imgGenApiKey.trim()))
  const busy = Boolean(action || submitting)
  const terminal = job && isTerminalJob(job)
  const succeeded = job?.status === 'succeeded'
  const kind = pending?.kind ?? job?.kind ?? 'children'
  const hasCommittedResult = job?.result && (job.kind === 'regenerate' ? Boolean(job.result.id) : job.kind === 'analyze' ? Boolean(job.result.node_id || job.result.nodes.length) : true)
  const resultSummary = hasCommittedResult && job?.result ? job.kind === 'regenerate' ? c('页面已更新', 'Page updated') : job.kind === 'analyze' ? c('第一页已创建', 'First page created') : c('已保留 ' + job.result.nodes.length + ' 个新页面', job.result.nodes.length + ' new pages kept') : null
  const resultDetail = hasCommittedResult && job?.result ? job.kind === 'regenerate' ? c('原页面已更新，页面编号与导航保持不变。', 'The page was updated. Its ID and navigation are unchanged.') : job.kind === 'analyze' ? c('第一张页面已保留。', 'The first page is kept.') : c('已保留 ' + job.result.nodes.length + ' 个新页面。', job.result.nodes.length + ' new pages kept.') : null
  const compact = succeeded && !pending && !job?.result?.warnings?.length && !job?.error && !connection && !error
  const operationLabel = kind === 'analyze' ? c('正在创建第一页', 'Creating the first page') : kind === 'regenerate' ? c('正在重新生成页面', 'Regenerating the page') : c('正在生成分支', 'Generating branches')
  const labels = {
    queued: c('任务已排队', 'Queued'), running: operationLabel,
    waiting_credentials: c('需要重新提供凭据', 'Credentials needed'), waiting_confirmation: c('上次调用结果待确认', 'Previous call needs review'),
    cancelling: c('正在取消', 'Cancelling'), succeeded: c('生成已完成', 'Generation complete'), partial: kind === 'children' ? c('部分页面已完成', 'Some pages completed') : c('页面已保存，请查看提示', 'Page saved with warnings'),
    failed: c('生成已停止', 'Generation stopped'), cancelled: c('任务已取消', 'Cancelled'),
  }
  if (!job && !pending && discovery === 'ready' && !connection) return emptyRoot ? <div className="generation-job" role="status"><strong>{c('此作品尚无页面或正在运行的任务', 'No page or active job yet')}</strong><p>{c('可返回创作输入，调整主题或重新选择图片。', 'Return to your input to adjust the topic or select an image.')}</p></div> : null
  const refreshButton = <button className="text-button" disabled={busy || discovery === 'loading'} onClick={() => useGenerationJobStore.getState().refresh()}>{c('重新查询状态', 'Refresh status')}</button>
  return <section className={'generation-job' + (compact ? ' generation-job--compact' : '')} aria-label={c('生成任务', 'Generation job')}>
    <div className="generation-job-summary" role="status" aria-live="polite"><strong>{pending ? c('正在核对提交结果', 'Checking submission') : job ? labels[job.status] : c('正在核对生成任务', 'Checking generation jobs')}</strong>
      {succeeded && resultSummary && <span>{resultSummary}</span>}
      {!succeeded && job?.message && job.message !== labels[job.status] && !(job.status === 'waiting_confirmation' && job.confirmation) && <p>{job.message}</p>}
      {job?.status === 'running' && typeof job.pct === 'number' && <progress max="100" value={job.pct} aria-label={c('生成进度', 'Generation progress')} />}
      {job && ['queued', 'running'].includes(job.status) && <p className="generation-job-detail">{c('任务在服务器运行，刷新或离开页面不会取消。', 'The server keeps working if you reload or leave this page.')}</p>}
      {syncing && <p>{c('正在同步已完成页面…', 'Syncing completed pages…')}</p>}
      {!succeeded && resultDetail && <p>{resultDetail}</p>}
    </div>
    {pending && <><p>{c('提交应答可能丢失。重试会先查询原操作，仅在未找到任务时使用原输入与模型配置提交，避免创建重复任务。', 'A response may have been lost. Retry first looks up the original operation, then submits its original inputs and models only if no job was found.')}</p>
      {pending.kind === 'analyze' && pending.file && <div className="generation-job-file">
        <label htmlFor={inputId}>{c('原图片：', 'Original image: ') + pending.file.name}</label>
        <p>{pendingUploadFile(pending.operation_id) || attachedOperation === pending.operation_id ? c('本次会话已有原图片，可用原操作重试。', 'The original image is available in this session.') : c('图片字节不保存在浏览器。若服务器尚未接收任务，请重新选择同一文件；系统会核对内容。', 'Image bytes are not stored in the browser. If the server has not accepted the job, select the same file. Its contents will be checked.')}</p>
        <input id={inputId} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          if (!file) return
          setError(null)
          void attachPendingUpload(pending, file).then(() => setAttachedOperation(pending.operation_id)).catch((error: Error) => setError(error.message))
        }} />
      </div>}
      {!matchesJobSettings(pending.provider_config, settings) && <p>{c('当前设置与原提交不同。请在设置中恢复原服务地址及模型后再重试。', 'Restore the original provider addresses and models in settings before retrying.')}</p>}
      <button className="btn" disabled={busy || discovery === 'loading' || !matchesJobSettings(pending.provider_config, settings)} onClick={() => void run('submit', () => submitGeneration(pending))}>{submitting ? c('提交中…', 'Submitting…') : c('用原操作重试提交', 'Retry original submission')}</button></>}
    {job?.status === 'waiting_credentials' && <>
      <p>{c('服务重启后，默认临时 Key 不会保留。请检查原任务配置，再显式提供当前凭据。', 'Temporary keys are not retained after a restart. Check the original configuration and explicitly provide credentials to resume.')}</p>
      <p className="generation-job-detail">{job.provider_config.llm_model} · {job.provider_config.imggen_model}</p>
      {!matching && <p>{c('当前服务地址或模型与原任务不同，请先恢复原配置。', 'Current provider addresses or models differ. Restore the original configuration first.')}</p>}
      <Link className="text-button" to="/settings">{c('配置 AI 服务', 'Set up AI')}</Link>
      <button className="btn btn-primary" disabled={busy || !matching || !hasKeys} onClick={() => void run('credentials', () => api.provideGenerationCredentials(job.job_id, useSettingsStore.getState()))}>{action === 'credentials' ? c('提供中…', 'Providing…') : c('使用当前设置恢复', 'Resume with current credentials')}</button>
    </>}
    {job?.status === 'waiting_confirmation' && job.confirmation && <>
      <p>{c('上一次服务调用可能已成功并计费，但本地未能确认结果。系统已暂停，避免自动重复调用。', 'The previous provider call may have succeeded and been billed, but its result could not be confirmed. Automatic retries are paused.')}</p>
      <p>{job.confirmation.message}</p>
      {job.confirmation.can_accept && <button className="btn btn-primary" disabled={busy} onClick={() => void run('accept', () => api.acceptGenerationJob(job.job_id, job.confirmation!.id))}>{job.confirmation.accept_label || c('保留已有内容并继续', 'Keep existing content and continue')}</button>}
      {job.confirmation.can_retry !== false && <button className="btn" disabled={busy} onClick={() => void retry()}>{c('重新调用，可能再次计费', 'Call again · may be billed again')}</button>}
    </>}
    {job && !terminal && <button className="btn" disabled={busy || job.status === 'cancelling'} onClick={() => void run('cancel', () => api.cancelGenerationJob(job.job_id))}>{job.status === 'cancelling' ? c('等待取消完成…', 'Waiting for cancellation…') : c('取消任务', 'Cancel job')}</button>}
    {job?.status === 'cancelling' && <p>{c('已发送的服务请求可能仍会完成并计费；已提交页面会保留。', 'A provider request already sent may still finish and be billed. Committed pages are kept.')}</p>}
    {job?.result?.warnings?.map((warning, index) => <p className="generation-job-detail" key={index}>{warning}</p>)}
    {job?.error && <p>{job.error.message}</p>}
    {terminal && !succeeded && <p>{job.kind === 'regenerate' ? job.status === 'partial' ? c('重新生成已结束，可继续编辑。未保存草稿仍在内容面板。', 'Regeneration ended. You can edit again; unsaved drafts remain in the content panel.') : c('原页面仍然保留，可在核对任务后重新发起。', 'The original page is kept. Review the task before starting again.') : job.kind === 'analyze' ? hasCommittedResult ? c('已保存的内容可继续编辑，完成后预览或导出。', 'Edit the saved content, then preview or export it.') : c('尚未创建页面，可返回创作输入调整后新建作品。', 'No page was created. Return to your input and start a new project.') : c('已有页面会保留。可继续选择尚无子页的热点再生成。', 'Existing pages are kept. Select hotspots without a page to generate more.')}</p>}
    {(connection || error) && <p className="generation-job-error" role="alert">{error || connection}</p>}
    {succeeded ? <details className="generation-job-history" key={job.job_id}>
      <summary>{c('查看任务详情', 'View job details')}</summary>
      {job.message && <p>{job.message}</p>}
      {resultDetail && <p>{resultDetail}</p>}
      {refreshButton}
    </details> : refreshButton}
  </section>
}
