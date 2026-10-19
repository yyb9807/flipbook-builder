import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { JSDOM, VirtualConsole } from 'jsdom'
import { buildPlayerRuntime } from './build-player.mjs'

const caseEnvironment = process.argv[2] === '--case' ? process.argv[3] : null

if (!caseEnvironment) {
  for (const environment of ['development', 'production']) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--case', environment], {
      env: { ...process.env, NODE_ENV: environment }, stdio: 'inherit',
    })
    assert.equal(result.status, 0, `Offline player failed in ${environment}`)
  }
} else {
  const hostEnvironment = process.env.NODE_ENV
  const runtime = await buildPlayerRuntime()
  assert.equal(process.env.NODE_ENV, hostEnvironment, 'A nested player build must preserve the host environment')
  assert.ok(!runtime.playerJs.includes('jsxDEV'), 'Production React must not receive development JSX calls')

  const titles = ['Root knowledge page', 'Child knowledge page', 'Leaf knowledge page']
  function node(index) {
    const id = `node-${index}`
    const childId = index < 2 ? `node-${index + 1}` : null
    return {
      id, parent_id: index ? `node-${index - 1}` : null, depth: index, title: titles[index],
      description: `Explanation for level ${index + 1}`, source_type: 'text', image_url: null,
      children: childId ? [childId] : [], status: 'completed',
      hotspots: childId ? [{ id: `connection-${index}`, kind: 'section', label: titles[index + 1],
        selected: false, target_node_id: childId, position: null, size: null }] : [],
      scene_document: { version: 1, layout: 'sequence', sections: [{ id: `section-${index}`,
        title: `Topic ${index + 1}`, body: `Readable structured knowledge at level ${index + 1}.`,
        reference_ids: [`reference-${index}`],
        ...(childId ? { hotspot_id: `connection-${index}`, target_node_id: childId } : {}),
      }] },
      content_metadata: {
        version: 1, provenance: { kind: 'ai', input_kind: index ? 'parent_page' : 'text', model: 'local-test-model' },
        references: [{ id: `reference-${index}`, title: `Author reference ${index + 1}`, url: `https://example.org/level-${index + 1}`, note: `Reference note ${index + 1}`,
          excerpt: `Saved original excerpt at level ${index + 1}. <script>plain text</script>`,
          source_revision: `revision-${index + 1}`, retrieved_at: '2026-10-19T06:00:00Z',
          license_title: 'CC BY-SA 4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
        }],
        review_status: index === 2 ? 'reviewed' : 'unreviewed',
      },
    }
  }
  const project = {
    project_id: 'offline-player-regression', name: 'Offline knowledge project', root_node_id: 'node-0',
    settings: { max_depth: 4, max_hotspots_per_page: 4, visual_style: 'encyclopedia', language: 'en' },
    nodes: Object.fromEntries([0, 1, 2].map((index) => [`node-${index}`, node(index)])),
  }
  const data = JSON.stringify(project).replace(/</g, '\\u003c')
  const errors = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', (error) => errors.push(error.message))
  const dom = new JSDOM(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${runtime.playerCss}</style></head><body><div id="flipbook-player"></div><script id="flipbook-data" type="application/json">${data}</script><script>${runtime.playerJs.replace(/<\/script/gi, '<\\/script')}</script></body></html>`, {
    runScripts: 'dangerously', url: 'file:///offline-project/index.html', pretendToBeVisual: true, virtualConsole,
  })
  const document = dom.window.document
  dom.window.addEventListener('error', (event) => errors.push(event.message))
  async function waitForPage(index) {
    const deadline = Date.now() + 2000
    while (document.querySelector('h1')?.textContent !== titles[index] && Date.now() < deadline) await setTimeout(10)
    assert.equal(document.querySelector('h1')?.textContent, titles[index], 'Built player must render the current page')
    assert.ok(document.body.textContent.includes(`Readable structured knowledge at level ${index + 1}.`))
    assert.ok(document.body.textContent.includes('local-test-model'))
    const reference = document.querySelector('.content-reference-list a')
    assert.equal(reference?.textContent, `Author reference ${index + 1}`)
    assert.equal(reference?.href, `https://example.org/level-${index + 1}`)
    assert.equal(reference?.rel, 'noopener noreferrer')
    assert.ok(document.body.textContent.includes('do not establish factual accuracy'))
    assert.ok(document.body.textContent.includes(`Source revision revision-${index + 1}`))
    const excerpt = document.querySelector('.reference-excerpt')
    excerpt.querySelector('summary').click()
    assert.equal(excerpt.open, true)
    assert.equal(excerpt.querySelector('blockquote').textContent, `Saved original excerpt at level ${index + 1}. <script>plain text</script>`)
    assert.equal(excerpt.querySelector('script'), null, 'Source content must remain plain text')
    assert.equal(document.querySelector('.reference-license a')?.href, 'https://creativecommons.org/licenses/by-sa/4.0/')
    const citation = document.querySelector('.section-citations a')
    assert.ok(citation, 'Each section must expose its citation')
    citation.click()
    assert.equal(document.activeElement, reference.closest('li'), 'A citation must focus the matching reference')
    document.querySelector('.reference-backlinks a').click()
    assert.equal(document.activeElement, document.querySelector('.scene-section'), 'A backlink must return focus to its section')
  }
  function clickButton(name) {
    const button = [...document.querySelectorAll('button')].find((element) => element.textContent === name)
    assert.ok(button, `Missing player navigation: ${name}`)
    button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  }
  try {
    await waitForPage(0)
    assert.ok(document.body.textContent.includes('Not yet reviewed by the author.'))
    clickButton(titles[1])
    await waitForPage(1)
    clickButton(titles[2])
    await waitForPage(2)
    assert.ok(document.body.textContent.includes('The author states that they reviewed this page.'))
    clickButton('Parent page')
    await waitForPage(1)
    clickButton(titles[0])
    await waitForPage(0)
    assert.deepEqual(errors, [], 'Built player must start and navigate without runtime errors')
    assert.equal(document.querySelector('script[type="module"]'), null)
    assert.equal(document.querySelector('script[src]'), null)
    console.log(JSON.stringify({ environment: caseEnvironment, script_bytes: Buffer.byteLength(runtime.playerJs), startup: true, three_level_navigation: true, references_and_provenance: true, source_excerpts_and_license: true, citation_and_return_focus: true, author_review_state: true, host_environment_preserved: true }))
  } finally { dom.window.close() }
}
