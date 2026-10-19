import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPlayerRuntime } from './build-player.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const output = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'backend/publication_runtime')
const runtime = await buildPlayerRuntime()
// Standalone publications have no editor stylesheet to reset the browser's
// default body margin. Match the existing offline HTML shell, without inline CSS.
const playerCss = 'html,body{margin:0;padding:0;min-height:100%;background:#f5f7f5}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}\n' + runtime.playerCss
await mkdir(output, { recursive: true })
await Promise.all([
  writeFile(resolve(output, 'player.js'), runtime.playerJs),
  writeFile(resolve(output, 'player.css'), playerCss),
])
process.stdout.write(`Publication player written to ${output}\n`)
