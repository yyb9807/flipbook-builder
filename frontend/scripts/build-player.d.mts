import type { Plugin } from 'vite'
export function offlinePlayerPlugin(): Plugin
export function buildPlayerRuntime(): Promise<{ playerJs: string; playerCss: string }>
