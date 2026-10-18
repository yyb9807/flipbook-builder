import { strToU8, zip } from 'fflate'
import type { FlipNode, Project } from '../types'
import { isImageHotspot } from '../types'
import { safeReferenceUrl } from './sourceUrl'

interface Runtime { playerJs: string; playerCss: string }
interface Asset { bytes: Uint8Array; mime: string; path: string }

/** Explicit allowlist: configuration, credentials and execution metadata never travel with a work. */
export function publicationSnapshot(project: Project): Project {
  const ids = new Set(Object.keys(project.nodes))
  const nodes: Record<string, FlipNode> = Object.fromEntries(Object.values(project.nodes).map((node) => [node.id, {
    id: node.id, parent_id: node.parent_id && ids.has(node.parent_id) ? node.parent_id : null,
    depth: node.depth, title: node.title, description: node.description,
    source_type: node.source_type, image_url: node.image_url,
    children: node.children.filter((id) => ids.has(id)), status: 'completed',
    hotspots: node.hotspots.map((hotspot) => ({
      id: hotspot.id, label: hotspot.label,
      ...(isImageHotspot(hotspot) ? {
        ...(hotspot.kind ? { kind: hotspot.kind } : {}),
        position: { x: hotspot.position.x, y: hotspot.position.y },
        size: { width: hotspot.size.width, height: hotspot.size.height },
      } : { kind: 'section' as const, position: null, size: null }),
      selected: false, target_node_id: hotspot.target_node_id && ids.has(hotspot.target_node_id) ? hotspot.target_node_id : null,
    })),
    ...(node.scene_document?.version === 1 ? { scene_document: {
      version: 1 as const, layout: node.scene_document.layout,
      sections: node.scene_document.sections.map((section) => ({
        id: section.id, title: section.title, body: section.body,
        ...(section.hotspot_id ? { hotspot_id: section.hotspot_id } : {}),
        ...(section.target_node_id && ids.has(section.target_node_id) ? { target_node_id: section.target_node_id } : {}),
      })),
    } } : {}),
    ...(node.content_metadata?.version === 1 ? { content_metadata: {
      version: 1 as const,
      ...(node.content_metadata.provenance ? { provenance: {
        kind: 'ai' as const, input_kind: node.content_metadata.provenance.input_kind,
        model: node.content_metadata.provenance.model,
      } } : {}),
      references: node.content_metadata.references.map((reference) => ({
        id: reference.id, title: reference.title,
        ...(reference.url && safeReferenceUrl(reference.url) ? { url: safeReferenceUrl(reference.url)! } : {}),
        ...(reference.note ? { note: reference.note } : {}),
      })),
      review_status: node.content_metadata.review_status,
    } } : {}),
  }]))
  return {
    project_id: project.project_id, name: project.name,
    root_node_id: project.root_node_id && ids.has(project.root_node_id) ? project.root_node_id : null,
    settings: {
      max_depth: project.settings.max_depth, max_hotspots_per_page: project.settings.max_hotspots_per_page,
      visual_style: project.settings.visual_style, language: project.settings.language,
    },
    nodes,
  }
}

export function safePublicationJson(project: Project): string {
  return JSON.stringify(project).replace(/[<>&\u2028\u2029]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

export function publicationHtml(project: Project, runtime: Runtime, inline: boolean): string {
  const title = escapeHtml(project.name)
  const language = project.settings.language?.startsWith('en') ? 'en' : 'zh-CN'
  const styles = inline ? `<style>${runtime.playerCss.replace(/<\/style/gi, '<\\/style')}</style>` : '<link rel="stylesheet" href="player.css">'
  const script = inline ? `<script>${runtime.playerJs.replace(/<\/script/gi, '<\\/script')}</script>` : '<script src="player.js"></script>'
  return `<!doctype html>\n<html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${title}</title><style>html,body{margin:0;padding:0;min-height:100%;background:#f5f7f5}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}</style>${styles}</head><body><div id="flipbook-player"><p style="padding:24px">正在打开作品… / Opening project…</p></div><script id="flipbook-data" type="application/json">${safePublicationJson(project)}</script>${script}</body></html>`
}

async function readAssets(project: Project): Promise<Map<string, Asset>> {
  const urls = [...new Set(Object.values(project.nodes).map((node) => node.image_url).filter((url): url is string => !!url))]
  const assets = new Map<string, Asset>()
  const formats: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif' }
  for (const [index, url] of urls.entries()) {
    const resolved = new URL(url, window.location.href)
    if (!['http:', 'https:', 'data:', 'blob:'].includes(resolved.protocol)) throw new Error('图片地址无法用于离线作品。 / This image URL cannot be exported.')
    const response = await fetch(resolved.href, { credentials: 'omit' })
    if (!response.ok) throw new Error(`图片下载失败，请确认图片可访问后重试。 / Image download failed (${response.status}).`)
    const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!formats[mime]) throw new Error('图片格式不受支持，离线作品未导出。 / Unsupported image format.')
    assets.set(url, { bytes: new Uint8Array(await response.arrayBuffer()), mime, path: `images/image-${index + 1}.${formats[mime]}` })
  }
  return assets
}

function replaceImages(project: Project, assets: Map<string, Asset>, inline: boolean): Project {
  for (const node of Object.values(project.nodes)) {
    if (!node.image_url) continue
    const asset = assets.get(node.image_url)
    if (!asset) continue
    if (inline) {
      let binary = ''
      for (let index = 0; index < asset.bytes.length; index += 8192) binary += String.fromCharCode(...asset.bytes.subarray(index, index + 8192))
      node.image_url = `data:${asset.mime};base64,${btoa(binary)}`
    } else node.image_url = asset.path
  }
  return project
}

/** A standalone HTML preview, with no module loader, fetch of JSON, or server requirement. */
export async function createOfflineHtml(project: Project): Promise<string> {
  const snapshot = publicationSnapshot(project)
  const [runtime, assets] = await Promise.all([import('virtual:offline-player'), readAssets(snapshot)])
  return publicationHtml(replaceImages(snapshot, assets, true), runtime, true)
}

/** Downloads all images once and bundles the same read-only React viewer used online. */
export async function createOfflineZip(project: Project): Promise<Blob> {
  const snapshot = publicationSnapshot(project)
  const [runtime, assets] = await Promise.all([import('virtual:offline-player'), readAssets(snapshot)])
  replaceImages(snapshot, assets, false)
  const entries: Record<string, Uint8Array> = {
    'index.html': strToU8(publicationHtml(snapshot, runtime, false)),
    'player.js': strToU8(runtime.playerJs),
    'player.css': strToU8(runtime.playerCss),
    'project.json': strToU8(JSON.stringify(snapshot, null, 2)),
    'README.txt': strToU8('解压整个文件夹，然后双击 index.html 打开作品。无需账号、API Key 或网络。\nExtract the entire folder, then open index.html. No account, API key or network is needed.\n\n保留 player.js、player.css 和 images 文件夹。\nKeep player.js, player.css and the images folder alongside index.html.\n'),
  }
  for (const asset of assets.values()) entries[asset.path] = asset.bytes
  const bytes = await new Promise<Uint8Array>((resolve, reject) => zip(entries, { level: 6 }, (error, data) => error ? reject(error) : resolve(data)))
  return new Blob([new Uint8Array(bytes)], { type: 'application/zip' })
}
