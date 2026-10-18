import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { build } from 'vite'
import react from '@vitejs/plugin-react'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const virtualId = 'virtual:offline-player'
const resolvedId = '\0' + virtualId

/** Builds the ordinary React viewer as a self-contained classic script for file://. */
export async function buildPlayerRuntime() {
  const result = await build({
    configFile: false,
    root,
    base: './',
    plugins: [react()],
    logLevel: 'error',
    // This build also runs inside the development server. Match the JSX transform
    // to the production React runtime without changing the host's NODE_ENV.
    oxc: { jsx: { runtime: 'automatic', development: false, refresh: false } },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      write: false,
      minify: true,
      cssCodeSplit: false,
      lib: { entry: resolve(root, 'src/player.tsx'), formats: ['iife'], name: 'FlipbookOfflinePlayer', fileName: () => 'player.js' },
    },
  })
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((item) => 'output' in item ? item.output : [])
  const script = outputs.find((item) => item.type === 'chunk' && item.isEntry)
  if (!script) throw new Error('Offline player build did not produce a script')
  const playerCss = outputs.filter((item) => item.type === 'asset' && item.fileName.endsWith('.css'))
    .map((item) => typeof item.source === 'string' ? item.source : new TextDecoder().decode(item.source)).join('\n')
  return { playerJs: script.code, playerCss }
}

export function offlinePlayerPlugin() {
  let pending
  return {
    name: 'flipbook-offline-player',
    resolveId(id) { if (id === virtualId) return resolvedId },
    async load(id) {
      if (id !== resolvedId) return
      pending ??= buildPlayerRuntime().catch((error) => { pending = undefined; throw error })
      const { playerJs, playerCss } = await pending
      return `export const playerJs = ${JSON.stringify(playerJs)}; export const playerCss = ${JSON.stringify(playerCss)};`
    },
    handleHotUpdate(context) {
      if (!context.file.includes('/components/scene/') && !context.file.endsWith('/src/player.tsx') && !context.file.endsWith('/src/utils/sourceUrl.ts')) return
      pending = undefined
      const module = context.server.moduleGraph.getModuleById(resolvedId)
      if (module) {
        context.server.moduleGraph.invalidateModule(module)
        return [...context.modules, module]
      }
    },
  }
}
