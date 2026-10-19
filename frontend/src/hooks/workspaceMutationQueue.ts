const mutationQueues = new Map<string, Promise<void>>()
const failedMutations = new Set<string>()
const historyLocks = new Set<string>()
interface AuthoringRevision { workspace: number; revision: number | undefined }
const revisions = new Map<string, AuthoringRevision>()
const resetListeners = new Set<(projectId: string) => void>()
export function onPendingMutationsReset(listener: (projectId: string) => void) { resetListeners.add(listener); return () => { resetListeners.delete(listener) } }
/** Only call after the author has explicitly reloaded and their unsaved snapshot is safely kept. */
export function resetProjectMutations(projectId: string) {
  for (const key of failedMutations) if (key.startsWith(projectId + '/')) failedMutations.delete(key)
  revisions.delete(projectId)
  for (const listener of resetListeners) listener(projectId)
}
export function authoringRevision(projectId: string, workspace: number, observed: number | undefined): AuthoringRevision {
  let token = revisions.get(projectId)
  if (!token || token.workspace !== workspace || !hasProjectMutations(projectId) && !hasFailedProjectMutations(projectId)) {
    token = { workspace, revision: observed }
    revisions.set(projectId, token)
  }
  return token
}
export function setMutationFailed(projectId: string, key: string, failed: boolean) {
  if (failed) failedMutations.add(`${projectId}/${key}`)
  else failedMutations.delete(`${projectId}/${key}`)
}
export function hasFailedProjectMutations(projectId: string) { return [...failedMutations].some((key) => key.startsWith(projectId + '/')) }
export function isHistoryRestoreActive(projectId: string) { return historyLocks.has(projectId) }
export function acquireHistoryRestore(projectId: string, allowFailed = false) {
  if (historyLocks.has(projectId) || hasProjectMutations(projectId) || !allowFailed && hasFailedProjectMutations(projectId)) return false
  historyLocks.add(projectId)
  return true
}
export function releaseHistoryRestore(projectId: string) { historyLocks.delete(projectId) }
export function enqueueMutation(key: string, operation: () => Promise<void>) {
  const request = (mutationQueues.get(key) ?? Promise.resolve()).catch(() => {}).then(operation)
  mutationQueues.set(key, request)
  void request.finally(() => { if (mutationQueues.get(key) === request) mutationQueues.delete(key) }).catch(() => {})
  return request
}
export function hasProjectMutations(projectId: string) {
  return [...mutationQueues.keys()].some((key) => key.startsWith(projectId + '/'))
}
export async function waitForProjectMutations(projectId: string) {
  while (hasProjectMutations(projectId)) {
    await Promise.allSettled([...mutationQueues].filter(([key]) => key.startsWith(projectId + '/')).map(([, request]) => request))
  }
}
