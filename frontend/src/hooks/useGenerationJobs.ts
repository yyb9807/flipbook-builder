import { useEffect } from 'react'
import { api } from '../api/client'
import { getWorkspaceRevision, useProjectStore } from '../store/projectStore'
import { currentProjectJob, useGenerationJobStore } from '../store/generationJobStore'
import { isTerminalJob, type GenerationJob } from '../types/jobs'
import { waitForProjectMutations } from './workspaceMutationQueue'
import { useCreationStore } from '../store/creationStore'
import { forgetUploadFile } from './generationJobs'
import type { Project } from '../types'

const reconciled = new Set<string>()
const reconciling = new Map<string, Promise<void>>()
const projectRefreshQueues = new Map<string, Promise<void>>()
const syncHolders = new Map<string, Map<string, number>>()

function releaseSync(projectId: string, signature: string) {
  const holders = syncHolders.get(projectId)
  holders?.delete(signature)
  useGenerationJobStore.getState().setSyncing(projectId, Boolean(holders?.size))
  if (!holders?.size) syncHolders.delete(projectId)
}

/** Only a server read can apply committed children. Drafts remain in their separate store. */
export async function reconcileGeneration(job: GenerationJob, revision = getWorkspaceRevision()) {
  if (!isTerminalJob(job)) return
  const signature = `${job.job_id}/${job.last_event_id}/${revision}`
  if (reconciled.has(signature)) { releaseSync(job.project_id, signature); return }
  if (reconciling.has(signature)) return reconciling.get(signature)
  const store = useGenerationJobStore.getState()
  const holders = syncHolders.get(job.project_id) ?? new Map<string, number>()
  // A previous visit no longer owns the visible workspace lock.
  for (const [token, holderRevision] of holders) { if (holderRevision !== revision) holders.delete(token) }
  holders.set(signature, revision)
  syncHolders.set(job.project_id, holders)
  store.setSyncing(job.project_id, true)
  const request = (projectRefreshQueues.get(job.project_id) ?? Promise.resolve()).catch(() => {}).then(async () => {
    try {
      const before = useProjectStore.getState()
      if (getWorkspaceRevision() !== revision || before.origin !== 'server' || before.project?.project_id !== job.project_id) return
      await waitForProjectMutations(job.project_id)
      const project = await api.getProject(job.project_id)
      const current = useProjectStore.getState()
      if (getWorkspaceRevision() === revision && current.origin === 'server' && current.project?.project_id === job.project_id) {
        current.adoptCommittedProject(project as Project)
        if (job.kind === 'analyze' && ['succeeded', 'partial'].includes(job.status) && (project as Project).root_node_id) {
          if (job.result?.keywords) useProjectStore.getState().setKeywords(job.result.keywords)
          useCreationStore.getState().clearSubmitted(job.operation_id)
        }
        reconciled.add(signature)
        store.setConnection(job.project_id, null)
      }
    } catch {
      store.setConnection(job.project_id, '任务已有结果，但页面同步失败。请重新查询状态；已完成的页面仍保留在服务器。')
    } finally {
      if (reconciled.has(signature) || getWorkspaceRevision() !== revision) releaseSync(job.project_id, signature)
      reconciling.delete(signature)
      if (projectRefreshQueues.get(job.project_id) === request) projectRefreshQueues.delete(job.project_id)
    }
  })
  projectRefreshQueues.set(job.project_id, request)
  reconciling.set(signature, request)
  return request
}

async function receive(job: GenerationJob, revision: number) {
  const store = useGenerationJobStore.getState()
  if (store.receive(job)) { forgetUploadFile(job.operation_id); await reconcileGeneration(job, revision) }
}

function delay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
    const timer = setTimeout(finish, milliseconds)
    signal.addEventListener('abort', finish, { once: true })
    if (signal.aborted) finish()
  })
}

/** Mounted once in App: route changes and tab reloads resume reads, never credentials. */
export function useGenerationJobs() {
  const projectId = useProjectStore((state) => state.project?.project_id)
  const origin = useProjectStore((state) => state.origin)
  const workspaceRevision = useProjectStore(() => getWorkspaceRevision())
  const refreshRevision = useGenerationJobStore((state) => state.refreshRevision)
  const jobId = useGenerationJobStore((state) => projectId ? currentProjectJob(state, projectId)?.job_id : undefined)

  useEffect(() => {
    if (!projectId || origin !== 'server') return
    const controller = new AbortController()
    const revision = workspaceRevision
    const store = useGenerationJobStore.getState()
    store.setDiscovery(projectId, 'loading')
    void (async () => {
      try {
        const pending = store.pending[projectId]
        const [active, operation] = await Promise.all([
          api.listGenerationJobs(projectId, controller.signal),
          pending ? api.listGenerationJobs(projectId, controller.signal, false, pending.operation_id) : Promise.resolve({ jobs: [] }),
        ])
        if (controller.signal.aborted) return
        const discovered = [...new Map([...active.jobs, ...operation.jobs].map((job) => [job.job_id, job])).values()]
        let historyUnavailable = false
        // The server bounds history to 100 snapshots. Keep only the latest one:
        // a fresh browser has no persisted reference to a failed or partial job.
        if (!discovered.length) {
          try {
            const history = await api.listGenerationJobs(projectId, controller.signal, false)
            if (controller.signal.aborted) return
            const latest = history.jobs.reduce<GenerationJob | undefined>((recent, job) => !recent || job.created_at > recent.created_at ? job : recent, undefined)
            if (latest) discovered.push(latest)
          } catch {
            if (controller.signal.aborted) return
            // Active discovery succeeded. A failed history read must not leave an
            // otherwise editable project permanently locked.
            historyUnavailable = true
          }
        }
        for (const job of discovered) { if (!controller.signal.aborted) await receive(job, revision) }
        const ids = Object.values(store.references).filter((reference) => reference.project_id === projectId && !discovered.some((job) => job.job_id === reference.job_id)).map((reference) => reference.job_id)
        const statuses = await Promise.allSettled(ids.map((id) => api.getGenerationJob(id, controller.signal)))
        if (controller.signal.aborted) return
        for (const status of statuses) {
          if (status.status === 'fulfilled') await receive(status.value, revision)
          else throw status.reason
        }
        if (!controller.signal.aborted) {
          store.setDiscovery(projectId, 'ready', revision)
          const latest = useGenerationJobStore.getState()
          if (!latest.pending[projectId] && !latest.syncing[projectId]) store.setConnection(projectId, historyUnavailable ? '已核对当前没有活动任务，但暂时无法读取最近结果。可继续编辑，或重新查询查看上次结果。' : null)
        }
      } catch {
        if (!controller.signal.aborted) { store.setDiscovery(projectId, 'error'); store.setConnection(projectId, '暂时无法核对生成任务。为避免重复生成，编辑与新生成暂不可用；请重新查询。') }
      }
    })()
    return () => { controller.abort() }
  }, [projectId, origin, refreshRevision, workspaceRevision])

  useEffect(() => {
    if (!jobId || !projectId || origin !== 'server') return
    const controller = new AbortController()
    const revision = workspaceRevision
    void (async () => {
      let attempts = 0
      while (!controller.signal.aborted) {
        try {
          const snapshot = await api.getGenerationJob(jobId, controller.signal)
          if (controller.signal.aborted) break
          await receive(snapshot, revision)
          if (isTerminalJob(snapshot) || controller.signal.aborted) break
          useGenerationJobStore.getState().setConnection(projectId, null)
          const cursor = useGenerationJobStore.getState().jobs[jobId]?.last_event_id ?? 0
          for await (const job of api.generationJobEvents(jobId, cursor, controller.signal)) {
            if (controller.signal.aborted) break
            if ((useGenerationJobStore.getState().jobs[jobId]?.last_event_id ?? -1) >= job.last_event_id) continue
            await receive(job, revision)
            attempts = 0
            if (isTerminalJob(job)) return
          }
          // EOF is just a disconnected subscription. It never completes/cancels the job.
        } catch { if (controller.signal.aborted) break }
        if (!controller.signal.aborted) {
          useGenerationJobStore.getState().setConnection(projectId, '连接已断开，正在重新查询任务。离开页面不会取消服务器任务。')
          await delay(Math.min(1000 * 2 ** attempts++, 10000), controller.signal)
        }
      }
    })()
    return () => { controller.abort() }
  }, [jobId, projectId, origin, refreshRevision, workspaceRevision])
}
