import type { FlipNode, Hotspot, Project, SceneSection } from '../types'

export const newId = () => crypto.randomUUID()

function hotspot(id: string, label: string, index: number, target: string | null): Hotspot {
  return { id, label, position: { x: 0.08 + (index % 2) * 0.48, y: 0.12 + Math.floor(index / 2) * 0.42 }, size: { width: 0.36, height: 0.28 }, selected: true, target_node_id: target }
}

function node(id: string, title: string, description: string, sections: SceneSection[], parent: string | null = null): FlipNode {
  return { id, parent_id: parent, depth: parent ? 1 : 0, title, description, source_type: 'text', image_url: null, status: 'completed', children: [], hotspots: [], scene_document: { version: 1, layout: parent ? 'sequence' : 'atlas', sections } }
}

export function createExampleProject(locale: 'zh' | 'en' = 'zh'): Project {
  const zh = locale === 'zh'
  const prefix = `local-${newId()}`
  const root = `${prefix}-root`
  const ids = ['evaporation', 'condensation', 'precipitation'].map((s) => `${prefix}-${s}`)
  const titles = zh ? ['蒸发', '凝结', '降水'] : ['Evaporation', 'Condensation', 'Precipitation']
  const bodies = zh ? [
    '太阳提供能量，让海洋、河流和地表的水变成水蒸气。植物也会通过蒸腾向空气中释放水分。',
    '水蒸气随空气上升并冷却，凝结成细小水滴或冰晶。许多微小颗粒聚在一起，形成我们看到的云。',
    '云中的水滴或冰晶增长后，以雨、雪等形式回到地面，再通过径流和渗透参与下一次循环。',
  ] : [
    'Energy from the Sun turns water from oceans, rivers and the ground into water vapour. Plants release moisture through transpiration too.',
    'As moist air rises and cools, water vapour condenses into tiny droplets or ice crystals. Together they form clouds.',
    'As droplets or ice crystals grow, water returns to the ground as rain or snow. Runoff and infiltration continue the cycle.',
  ]
  const sections = titles.map((title, i) => ({ id: `section-${i}`, title, body: bodies[i], hotspot_id: `hotspot-${i}`, target_node_id: ids[i] }))
  const rootNode = node(root, zh ? '一滴水的旅程' : 'The journey of a water drop', zh ? '水在地表与大气之间不断流动。选择一个过程，看看它如何发生。' : 'Water keeps moving between Earth’s surface and atmosphere. Choose a process to explore how it happens.', sections)
  rootNode.hotspots = titles.map((title, i) => hotspot(`hotspot-${i}`, title, i, ids[i]))
  rootNode.image_url = '/examples/water-cycle.svg'
  rootNode.children = ids
  const childContent = zh ? [
    [['能量来自哪里？', '水的蒸发需要能量。阳光加热地表，促使更多水分子离开液态水表面。'], ['不只有海洋', '湖泊、土壤和植物同样向空气提供水分。温度、湿度和风都会影响蒸发。']],
    [['看不见的水蒸气', '水蒸气本身不可见。我们看到的云，是由悬浮的微小水滴或冰晶组成的。'], ['冷却与凝结', '空气冷却到一定条件时，水蒸气在微小颗粒周围凝结，形成云滴。']],
    [['水回到地面', '降水可以是雨、雪或其他形式，具体取决于云中和落下途中的温度条件。'], ['旅程继续', '一部分水流入河流和海洋，一部分进入土壤与地下，还有一部分再次蒸发。']],
  ] : [
    [['Where does the energy come from?', 'Evaporation requires energy. Sunlight warms the surface and helps water molecules leave liquid water.'], ['More than oceans', 'Lakes, soil and plants also supply moisture. Temperature, humidity and wind affect evaporation.']],
    [['Invisible water vapour', 'Water vapour is invisible. Clouds consist of suspended tiny droplets or ice crystals.'], ['Cooling and condensation', 'Under suitable conditions, cooling air allows water vapour to condense around tiny particles and form cloud droplets.']],
    [['Back to the ground', 'Precipitation can fall as rain, snow or other forms depending on the temperatures within and below the cloud.'], ['The journey continues', 'Some water flows towards rivers and oceans, some enters the soil, and some evaporates again.']],
  ]
  const nodes: Record<string, FlipNode> = { [root]: rootNode }
  ids.forEach((id, i) => { nodes[id] = node(id, titles[i], bodies[i], childContent[i].map(([title, body], j) => ({ id: `detail-${i}-${j}`, title, body })), root) })
  return { project_id: prefix, name: zh ? '一滴水的旅程 · 示例' : 'A water drop · example', root_node_id: root, settings: { max_depth: 4, max_hotspots_per_page: 4, visual_style: 'encyclopedia', language: locale }, nodes }
}

export function createManualProject(topic: string, locale: 'zh' | 'en'): Project {
  const id = `local-${newId()}`
  const root = `${id}-root`
  const title = topic.trim().slice(0, 100) || (locale === 'zh' ? '未命名作品' : 'Untitled project')
  const rootNode = node(root, title, '', [{ id: newId(), title: locale === 'zh' ? '第一个要点' : 'Your first idea', body: '' }])
  return { project_id: id, name: title, root_node_id: root, settings: { max_depth: 4, max_hotspots_per_page: 4, visual_style: 'encyclopedia', language: locale }, nodes: { [root]: rootNode } }
}

export async function createManualImageProject(file: File, locale: 'zh' | 'en'): Promise<Project> {
  const zh = locale === 'zh'
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error(zh ? '本地标注支持 PNG、JPEG 和 WebP。' : 'Local annotation supports PNG, JPEG and WebP.')
  if (file.size > 2 * 1024 * 1024) throw new Error(zh ? '本地图片请小于 2 MB，避免超过浏览器存储空间。较大图片可使用 AI 上传流程。' : 'Use an image under 2 MB for browser storage. Larger images can use the AI upload flow.')
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error(zh ? '图片读取失败，请重新选择。' : 'Could not read the image. Select it again.'))
    reader.readAsDataURL(file)
  })
  await new Promise<void>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve()
    image.onerror = () => reject(new Error(zh ? '图片无法解码，请选择有效图片。' : 'The image could not be decoded. Choose a valid image.'))
    image.src = url
  })
  const project = createManualProject(file.name.replace(/\.[^.]+$/, ''), locale)
  const root = project.nodes[project.root_node_id!]
  root.source_type = 'image'
  root.image_url = url
  root.scene_document = null
  root.hotspots = []
  return project
}
