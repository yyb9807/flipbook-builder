/**
 * 翻译字典 —— 单一 source of truth。
 *
 * 约定：
 *   1. key 用 `domain.subdomain.key` 风格，方便分组和查找
 *   2. 占位符用 `{name}` 形式，由 `t(key, { name: 'foo' })` 注入
 *   3. 只覆盖 user-facing 字符串。代码注释、log、错误堆栈仍用中文/英文原始语言
 *   4. 新增 key 必须 zh + en 同步加，TS 类型会强制
 */

export const TRANSLATIONS = {
  // ── 通用 / 全局 ──
  // 品牌名固定为 flipbook-builder（中英一致）
  'common.appName': { zh: 'flipbook-builder', en: 'flipbook-builder' },
  'common.save': { zh: '保存', en: 'Save' },
  'common.cancel': { zh: '取消', en: 'Cancel' },
  'common.confirm': { zh: '确定', en: 'Confirm' },
  'common.delete': { zh: '删除', en: 'Delete' },
  'common.loading': { zh: '加载中…', en: 'Loading…' },
  'common.retry': { zh: '重试', en: 'Retry' },
  'common.back': { zh: '返回', en: 'Back' },
  'common.advanced': { zh: '高级', en: 'Advanced' },

  // ── 顶栏 ──
  'topbar.home': { zh: '返回主页', en: 'Back to home' },
  'topbar.homeTooltip': { zh: '返回主页 / 重新开始', en: 'Home / start over' },
  'topbar.settings': { zh: '配置', en: 'Settings' },
  'topbar.settingsMissingKey': { zh: '配置 API Key', en: 'Set API Key' },
  'topbar.confirmHomeTitle': { zh: '返回主页？', en: 'Back to home?' },
  'topbar.confirmHomeMessage': {
    zh: '当前项目仍会保留，可以从「我的项目」再次打开。',
    en: 'Your current project is preserved and can be reopened from "My Projects".',
  },

  // ── 设置页 ──
  'settings.navTitle': { zh: 'AI 配置', en: 'AI Settings' },
  'settings.section.llm': { zh: '文本 LLM', en: 'Text LLM' },
  'settings.section.imggen': { zh: '图片生成', en: 'Image Generation' },
  'settings.status.ok': { zh: '已配置', en: 'Configured' },
  'settings.status.missing': { zh: '缺 API Key', en: 'Missing API Key' },
  'settings.field.provider': { zh: '服务商', en: 'Provider' },
  'settings.field.apiKey': { zh: 'API Key', en: 'API Key' },
  'settings.field.model': { zh: '模型', en: 'Model' },
  'settings.field.baseUrl': { zh: 'API Base URL', en: 'API Base URL' },
  'settings.field.advancedBaseUrl': {
    zh: '高级:自定义 Base URL',
    en: 'Advanced: custom Base URL',
  },
  'settings.field.savedKey': { zh: '已存: {value}', en: 'Saved: {value}' },
  'settings.field.unsetKey': { zh: '未设置', en: 'Not set' },
  'settings.subtitle.notConfigured': { zh: '未配置', en: 'not configured' },
  'settings.subtitle.noModel': { zh: '未选模型', en: 'no model' },

  'settings.action.save': { zh: '保存配置', en: 'Save settings' },
  'settings.action.saved': { zh: '✓ 已保存', en: '✓ Saved' },
  'settings.action.test': { zh: '测试连接', en: 'Test connection' },
  'settings.action.testing': { zh: '测试中…', en: 'Testing…' },
  'settings.action.dirty': { zh: '有未保存更改', en: 'Unsaved changes' },
  'settings.action.savedHint': { zh: '✓ 已保存到本地', en: '✓ Saved locally' },
  'settings.action.privacyHint': {
    zh: '密钥仅存浏览器，不上传服务器',
    en: 'Keys stored locally in browser only',
  },

  'settings.test.failed': { zh: '测试失败：{error}', en: 'Test failed: {error}' },
  'settings.test.unknownError': { zh: '测试失败', en: 'Test failed' },
  'settings.test.modelReply': { zh: '模型回复：{sample}', en: 'Model reply: {sample}' },
  'settings.test.keyChars': { zh: 'key {n} 字符', en: 'key {n} chars' },
  'settings.test.labelLlm': { zh: 'LLM', en: 'LLM' },
  'settings.test.labelImg': { zh: '图片生成', en: 'Image gen' },

  'settings.quickStart.title': { zh: '第一次来？三步配好', en: 'First time? 3 steps' },
  'settings.quickStart.steps': {
    zh: '① 选服务商 → ② 粘贴 API Key → ③ 点击「测试连接」验证',
    en: '① Pick provider → ② Paste API Key → ③ Click "Test connection"',
  },
  'settings.quickStart.noKey': { zh: '没有 key？去注册：', en: 'No key yet? Sign up:' },

  'settings.placeholder.modelLlm': { zh: 'claude-sonnet-4-6', en: 'claude-sonnet-4-6' },
  'settings.placeholder.modelImg': { zh: 'dall-e-3', en: 'dall-e-3' },
  'settings.placeholder.keyAnthropic': { zh: 'sk-ant-...', en: 'sk-ant-...' },
  'settings.placeholder.keyGeneric': { zh: 'sk-...', en: 'sk-...' },

  // ── 服务商显示名（覆盖 LLM_PROVIDERS 里的 name 字段） ──
  'provider.anthropic': { zh: 'Anthropic（官方）', en: 'Anthropic (official)' },
  'provider.openai': { zh: 'OpenAI（官方）', en: 'OpenAI (official)' },
  'provider.openrouter': { zh: 'OpenRouter', en: 'OpenRouter' },
  'provider.deepseek': { zh: 'DeepSeek（官方）', en: 'DeepSeek (official)' },
  'provider.custom': { zh: '自定义', en: 'Custom' },

  // ── 首页 ──
  'home.hero.title': { zh: '把灵感', en: 'Turn ideas' },
  'home.hero.titleAccent': { zh: '一键变成', en: 'into' },
  'home.hero.titleEnd': { zh: '可点的故事', en: 'clickable stories' },
  'home.hero.subtitle': {
    zh: '上传图片 / 输入想法 → AI 生成主图 + 热点 + 子页面',
    en: 'Upload an image or describe an idea → AI generates cover + hotspots + sub-pages',
  },
  'home.cta.create': { zh: '开始创作', en: 'Start creating' },
  'home.cta.createSub': { zh: '上传图片或描述场景', en: 'Upload an image or describe a scene' },
  'home.steps.0': { zh: '分析内容中', en: 'Analyzing content' },
  'home.steps.1': { zh: '生成封面图', en: 'Generating cover' },
  'home.steps.2': { zh: '识别热点区域', en: 'Detecting hotspots' },
  'home.steps.3': { zh: '搭建页面结构', en: 'Building structure' },
  'home.projects.title': { zh: '我的项目', en: 'My Projects' },
  'home.projects.empty': { zh: '还没有项目，开始创作你的第一本书吧 ✨', en: 'No projects yet — start your first book ✨' },
  'home.projects.count': { zh: '{n} 个项目', en: '{n} projects' },
  'home.projects.noneShort': { zh: '暂无项目', en: 'None yet' },
  'home.projects.loading': { zh: '加载中…', en: 'Loading…' },
  'home.projects.loadFailed': { zh: '加载历史项目失败：{error}', en: 'Failed to load projects: {error}' },
  'home.projects.deleteTitle': { zh: '删除「{name}」？', en: 'Delete "{name}"?' },
  'home.projects.deleteMessage': {
    zh: '此操作不可撤销。所有页面、热点和图片文件都会被永久删除。',
    en: 'This cannot be undone. All pages, hotspots, and image files will be permanently deleted.',
  },
  'home.projects.deleted': { zh: '已删除「{name}」', en: 'Deleted "{name}"' },
  'home.projects.deleteFailed': { zh: '删除失败：{error}', en: 'Delete failed: {error}' },
  'home.projects.fetchFailed': { zh: '加载失败：{error}', en: 'Load failed: {error}' },
  'home.create.title': { zh: '创作新项目', en: 'New Project' },
  'home.create.subtitle': {
    zh: '上传图片或粘贴文字，AI 为你生成可翻页的世界。',
    en: 'Upload an image or paste text — AI builds a flippable world for you.',
  },
  'home.tab.image': { zh: '图片', en: 'Image' },
  'home.tab.text': { zh: '文字', en: 'Text' },
  'home.text.placeholder': {
    zh: '描述一个场景…例如「黄昏时分，一座静湖旁的樱花公园」',
    en: 'Describe a scene… e.g. "A cherry blossom park beside a quiet lake at dusk"',
  },
  'home.image.dropHint': { zh: '拖入图片或点击上传', en: 'Drop an image or click to upload' },
  'home.image.dropMeta': { zh: 'JPG, PNG, WEBP — 最大 20MB', en: 'JPG, PNG, WEBP — up to 20MB' },
  'home.image.replace': { zh: '更换', en: 'Replace' },
  'home.image.keywordsPlaceholder': {
    zh: '关键词（可选）：用逗号分隔，例如：建筑风格, 历史背景',
    en: 'Keywords (optional): comma-separated, e.g. architecture, history',
  },
  'home.image.errUnsupportedType': {
    zh: '不支持「{type}」，请上传图片',
    en: 'Unsupported file type "{type}", please upload an image',
  },
  'home.image.errUnknownType': { zh: '未知类型', en: 'unknown type' },
  'home.image.errFormat': {
    zh: '仅支持 JPG / PNG / WEBP（你上传的是 {type}）',
    en: 'Only JPG / PNG / WEBP supported (you uploaded {type})',
  },
  'home.image.errSize': { zh: '文件 {mb} MB 超过 20 MB 上限', en: 'File is {mb} MB, exceeding the 20 MB limit' },
  'home.cta.configKey': { zh: '去配置 API Key', en: 'Set API Key' },
  'home.cta.start': { zh: '开始构建', en: 'Start building' },
  'home.cta.analyzing': { zh: '分析中…', en: 'Analyzing…' },
  'home.decor.l0': { zh: 'L0 · 起始页', en: 'L0 · Cover' },
  'home.decor.l1': { zh: 'L1 · 子页面', en: 'L1 · Sub-page' },
  'home.decor.l2': { zh: 'L2 · 深入', en: 'L2 · Deeper' },
  'home.time.justNow': { zh: '刚刚', en: 'just now' },
  'home.time.minutesAgo': { zh: '{n} 分钟前', en: '{n} min ago' },
  'home.time.hoursAgo': { zh: '{n} 小时前', en: '{n} h ago' },
  'home.time.daysAgo': { zh: '{n} 天前', en: '{n} d ago' },
  'home.projects.noCover': { zh: '无封面', en: 'No cover' },
  'home.projects.pages': { zh: '{n} 页', en: '{n} pages' },
  'home.projects.delete': { zh: '删除', en: 'Delete' },
  'home.projects.openLabel': { zh: '打开「{name}」', en: 'Open "{name}"' },
  'home.projects.deleteLabel': { zh: '删除「{name}」', en: 'Delete "{name}"' },
  'home.projects.emptyTitle': { zh: '还没有作品', en: 'No projects yet' },
  'home.projects.emptyHint': { zh: '从上方「创作新项目」开始你的第一个 ↑', en: 'Start your first one above ↑' },

  // ── API Key 警告条 ──
  'apiKeyWarning.title': { zh: '尚未配置 API Key', en: 'API Key not configured' },
  'apiKeyWarning.body': {
    zh: '生成功能需要 LLM 服务的 API Key。点击右上角「配置 API Key」填入。',
    en: 'Generation requires an LLM API Key. Click "Set API Key" in the top-right to configure.',
  },
  'apiKeyWarning.cta': { zh: '去配置', en: 'Configure now' },
  'apiKeyWarning.short': {
    zh: 'LLM API Key 未配置，上传内容将无法分析',
    en: 'LLM API Key not set — uploads cannot be analyzed',
  },
  'apiKeyWarning.go': { zh: '前往设置 →', en: 'Open settings →' },

  // ── 语言切换器 ──
  'locale.zh': { zh: '中文', en: 'Chinese' },
  'locale.en': { zh: 'English', en: 'English' },
  'locale.switchTo': { zh: 'Switch to {target}', en: 'Switch to {target}' },

  // ── Builder ──
  'builder.tree.title': { zh: '结构', en: 'Structure' },
  'builder.tree.empty': { zh: '尚无页面', en: 'No pages yet' },
  'builder.tree.back': { zh: '返回', en: 'Back' },
  'builder.tree.pages': { zh: '页面', en: 'Pages' },
  'builder.tree.depth': { zh: '层深', en: 'Depth' },
  'builder.tree.regenerateTooltip': { zh: '重新生成此页', en: 'Regenerate this page' },
  'builder.tree.regenerateLabel': { zh: '重新生成「{name}」', en: 'Regenerate "{name}"' },

  'builder.canvas.dragHint': {
    zh: '拖动热点 · 点击进入子页 · 粉色代表已有子页',
    en: 'Drag to reposition · Click to enter sub-page · Pink = has sub-page',
  },

  'builder.children.title': { zh: '子页面', en: 'Sub-pages' },
  'builder.children.openLabel': { zh: '打开「{name}」', en: 'Open "{name}"' },
  'builder.children.regenerateLabel': { zh: '重新生成「{name}」', en: 'Regenerate "{name}"' },
  'builder.children.imageFailed': { zh: '⚠ {name}\n图片生成失败', en: '⚠ {name}\nImage generation failed' },

  'builder.generate.label': { zh: '生成子页面', en: 'Generate sub-pages' },
  'builder.generate.loading': { zh: '生成中…', en: 'Generating…' },

  'builder.hotspot.saveFailed': { zh: '保存失败：{error}', en: 'Save failed: {error}' },
  'builder.hotspot.currentPage': { zh: '当前页内容', en: 'Current page' },
  'builder.hotspot.step1': { zh: '① 选择想展开的区域', en: '① Pick areas to expand' },
  'builder.hotspot.eachToSubpage': { zh: '每个勾选的区域 → 生成一个独立的子页面', en: 'Each ticked area → one new sub-page' },
  'builder.hotspot.empty1': { zh: 'AI 未能识别热点区域', en: 'AI did not detect any hotspots' },
  'builder.hotspot.empty2': { zh: '请尝试重新上传，或上传更具体的图片/文字', en: 'Try re-uploading or use a more specific image/text' },
  'builder.hotspot.subpageDone': { zh: '已生成子页', en: 'Sub-page ready' },
  'builder.hotspot.confidence': { zh: '置信度 {n}%', en: 'Confidence {n}%' },
  'builder.hotspot.dblclickToEdit': { zh: '双击编辑标签', en: 'Double-click to edit' },

  'builder.keyword.step2': { zh: '② 添加内容侧重（可选）', en: '② Steer content (optional)' },
  'builder.keyword.selected': { zh: '{n} 已选', en: '{n} selected' },
  'builder.keyword.hint': { zh: '勾选会引导子页面朝这些方向展开', en: 'Picks will steer how sub-pages expand' },

  'builder.actions.share': { zh: '分享', en: 'Share' },
  'builder.actions.shareTooltip': { zh: '分享 / 导出', en: 'Share / Export' },
  'builder.actions.copyLink': { zh: '复制分享链接', en: 'Copy share link' },
  'builder.actions.copyLinkHint': { zh: '只读，任何人能打开', en: 'Read-only, anyone with the link' },
  'builder.actions.exportJson': { zh: '导出 JSON', en: 'Export JSON' },
  'builder.actions.exportJsonHint': { zh: '项目结构 + 元数据，可备份', en: 'Structure + metadata, for backup' },
  'builder.actions.exportZip': { zh: '导出离线 ZIP', en: 'Export offline ZIP' },
  'builder.actions.exportZipHint': { zh: '解压后双击 index.html，含全部图片', en: 'Unzip, open index.html — full images included' },
  'builder.actions.linkCopied': { zh: '分享链接已复制 · 任何人打开都能只读浏览', en: 'Share link copied · anyone can view read-only' },
  'builder.actions.copyPrompt': { zh: '复制此链接：', en: 'Copy this link:' },
  'builder.actions.jsonExported': { zh: '已导出 JSON', en: 'JSON exported' },
  'builder.actions.zipExported': { zh: '已导出离线 ZIP，解压后双击 index.html 打开', en: 'Offline ZIP exported — unzip and open index.html' },
  'builder.actions.exportFailed': { zh: '导出失败：{error}', en: 'Export failed: {error}' },

  // ── Viewer ──
  'viewer.continueHint': { zh: '点击图中高亮区域继续探索 ↑', en: 'Click any highlighted spot to dive deeper ↑' },
  'viewer.endpoint': { zh: '{name}（终点页面）', en: '{name} (end of tree)' },
  'viewer.back': { zh: '返回', en: 'Back' },
  'viewer.title': { zh: '{app} · 浏览模式', en: '{app} · Read mode' },
  'viewer.exit': { zh: '返回创作', en: 'Back to editor' },
  'mode.viewer': { zh: '▶ 进入浏览模式', en: '▶ Enter read mode' },
  'mode.editor': { zh: '← 返回创作', en: '← Back to editor' },

  // ── 共享对话框 / Toast / Spinner ──
  'spinner.creating': { zh: '正在创建…', en: 'Creating…' },
  'spinner.wait': { zh: '稍等片刻 — AI 正在处理。', en: 'Hang tight — AI is working.' },
  'spinner.totalElapsed': { zh: '{pct}% · 总计 {time}', en: '{pct}% · total {time}' },
  'spinner.cancel': { zh: '取消生成', en: 'Cancel' },

  // ── 页脚 + 关于 ──
  'footer.poweredBy': { zh: 'Powered by', en: 'Powered by' },
  'footer.about': { zh: '关于', en: 'About' },

  'about.navTitle': { zh: '关于', en: 'About' },
  'about.lead': {
    zh: '把任何一张图变成"可以无限往下点"的视觉知识树。',
    en: 'Turn any image into a visual knowledge tree you can drill into forever.',
  },
  'about.whyTitle': { zh: '为什么做这个', en: 'Why this exists' },
  'about.whyBody': {
    zh: '看到 Zain Shah 的 Flipbook 在 X 上爆火 —— 一种点哪都能继续往下走的"像素流漫游"，很美也很梦幻。但它只能看不能改、过完就过完了。我想要的是同样的"点哪进哪"，但每一层都落地成可保存、可编辑、可导出的页面。这就是 flipbook-builder。',
    en: 'When Zain Shah\'s Flipbook went viral on X with its dreamy pixel-streamed exploration, I loved it — but you couldn\'t save, edit, or export anything. I wanted the same "click anything to dive in" feeling, but with every layer captured as a real, editable, exportable page. That\'s flipbook-builder.',
  },
  'about.howTitle': { zh: '怎么做到的', en: 'How it works' },
  'about.howBody': {
    zh: '后端把"理解 → 规划 → 生图 → 标热点"拆成 5 个 agent，AI 看图后按内容自动选地图 / 图鉴 / 场景 / 剖面 4 种构图之一，再让视觉 LLM 在新画的图上标出可点击区域。整条流水线通过 SSE 流式推到前端。',
    en: 'The backend pipeline splits "understand → plan → render → annotate" into 5 agents. After analyzing your input, AI picks one of 4 compositions (map / plate / scene / diagram) by content type, generates the image, then a vision LLM marks clickable hotspots on it. Everything streams to the frontend via SSE.',
  },
  // ── About: 多 Agent 流水线 ──
  'about.agentsTitle': { zh: '多 Agent 编排', en: 'Multi-agent orchestration' },
  'about.agentsIntro': {
    zh: '后端把"理解输入 → 选构图 → 写文案 → 生图 → 标热点"拆成 5 个职责单一的 agent，串成 SSE 流式流水线。每个 agent 都继承同一个 BaseLLMAgent，统一处理 Anthropic / OpenAI 兼容协议、prompt caching、错误重试。',
    en: 'The backend splits "understand → compose → write → render → annotate" into 5 single-responsibility agents, chained into an SSE streaming pipeline. All agents extend a shared BaseLLMAgent that handles Anthropic / OpenAI-compatible protocols, prompt caching, and retries.',
  },
  'about.agent.inputAnalysis': { zh: '理解输入', en: 'Understand input' },
  'about.agent.inputAnalysis.desc': {
    zh: '视觉 LLM 看图 / 读文 → summary / scene_type / 关键词',
    en: 'Vision LLM reads image/text → summary, scene type, keywords',
  },
  'about.agent.composition': { zh: '选构图', en: 'Pick composition' },
  'about.agent.composition.desc': {
    zh: '按 scene_type 路由到 4 种 prose-style prompt：地图 / 图鉴 / 场景 / 剖面',
    en: 'Routes by scene_type to 4 prose-style prompts: map / plate / scene / diagram',
  },
  'about.agent.pageGeneration': { zh: '写子页文案', en: 'Write sub-pages' },
  'about.agent.pageGeneration.desc': {
    zh: 'LLM 为每个子页生成 title / description / 子热点',
    en: 'LLM produces title / description / sub-hotspots for each child page',
  },
  'about.agent.imageGeneration': { zh: '生图', en: 'Render image' },
  'about.agent.imageGeneration.desc': {
    zh: 'DALL-E 3 / Flux 出图，相同 (model, prompt) 命中 SHA256 缓存跳过 API',
    en: 'DALL-E 3 / Flux render; SHA256 cache skips API on identical (model, prompt)',
  },
  'about.agent.hotspotLocalization': { zh: '标热点', en: 'Annotate hotspots' },
  'about.agent.hotspotLocalization.desc': {
    zh: '视觉 LLM 在出好的图上标可点击区域（normalized [0,1] bbox + label）',
    en: 'Vision LLM marks clickable regions on the rendered image (normalized [0,1] bbox + label)',
  },
  'about.agent.savings': {
    zh: 'Prompt caching：同一 system prompt 5 分钟内复用，并发生成 4 个子页时只第一次完整收费，后 3 次几乎免费（节省 ~90% input token）。',
    en: 'Prompt caching: same system prompt within 5 min reuses cache. When generating 4 sub-pages in parallel, only the first call pays full price (~90% input-token savings on the rest).',
  },

  'about.stackTitle': { zh: '技术栈', en: 'Stack' },
  'about.stackFrontend': {
    zh: 'React 19 · Vite · TypeScript · Zustand · 中英 i18n',
    en: 'React 19 · Vite · TypeScript · Zustand · zh/en i18n',
  },
  'about.stackBackend': {
    zh: 'FastAPI · uvicorn · Postgres 16 · asyncpg · Pillow',
    en: 'FastAPI · uvicorn · Postgres 16 · asyncpg · Pillow',
  },
  'about.stackAi': {
    zh: 'Anthropic / OpenAI / OpenRouter · DALL-E 3 / Flux · prompt caching · 图片 SHA256 缓存',
    en: 'Anthropic / OpenAI / OpenRouter · DALL-E 3 / Flux · prompt caching · image SHA256 cache',
  },
  'about.stackDeploy': {
    zh: 'Docker Compose 一键启动 · nginx 反代 + SSE 长连接',
    en: 'Docker Compose one-shot · nginx reverse proxy + SSE long-poll',
  },
  'about.creditsTitle': { zh: '致谢', en: 'Credits' },
  'about.creditsBody': {
    zh: '灵感来自 Zain Shah 的 Flipbook、eren23 的 openflipbook，以及启发"分层视觉知识"的 David Macaulay 与 DK Eyewitness 系列。',
    en: 'Inspired by Zain Shah\'s Flipbook, eren23\'s openflipbook, and the "layered visual knowledge" tradition of David Macaulay and DK Eyewitness.',
  },
  'about.contactTitle': { zh: '联系', en: 'Contact' },
  'about.contactBody': {
    zh: '对实现细节、合作或类似问题感兴趣的，欢迎来邮：',
    en: 'For implementation details, collaboration, or related questions, feel free to reach out:',
  },

  // ── ErrorBoundary ──
  'error.title': { zh: '页面出现了问题', en: 'Something went wrong' },
  'error.body': {
    zh: '刷新页面重试。如果问题持续出现，可能是项目数据损坏，可以从「我的项目」选择其他项目，或新建一个。',
    en: 'Try refreshing. If the issue persists, project data may be corrupted — pick another from "My Projects" or start a new one.',
  },
  'error.detailsLabel': { zh: '错误详情（仅开发模式可见）', en: 'Error details (dev only)' },
  'error.refresh': { zh: '刷新页面', en: 'Refresh' },
  'error.clearCache': { zh: '清空缓存重试', en: 'Clear cache & retry' },
  'error.clearConfirm': {
    zh: '清除所有本地数据并刷新？这会清空 API Key 和项目状态（项目本身在数据库中不会删除）。',
    en: 'Clear all local data and refresh? This wipes API keys and UI state (projects in DB are kept).',
  },
} as const

export type TranslationKey = keyof typeof TRANSLATIONS
export const SUPPORTED_LOCALES = ['zh', 'en'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
