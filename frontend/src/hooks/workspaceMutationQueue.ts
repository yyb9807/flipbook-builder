const mutationQueues = new Map<string, Promise<void>>()
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
