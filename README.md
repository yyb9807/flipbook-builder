# flipbook-builder

**[English](./README.en.md)** · 中文

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-yyb9807%2Fflipbook--builder-181717?logo=github)](https://github.com/yyb9807/flipbook-builder)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Postgres](https://img.shields.io/badge/Postgres-16-336791?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/compose/)
[![i18n](https://img.shields.io/badge/i18n-zh%20%2F%20en-AF52DE)](#)
[![PRs](https://img.shields.io/badge/PRs-welcome-brightgreen)](#)

> **给任意一张图加上"无限往下点"的能力。** 像 [Flipbook](https://flipbook.page/)，但能存、能改、能导出。

[Flipbook](https://flipbook.page/) 那种"点哪去哪"的视觉漫游很爽，可惜只能看不能改、过完就过完。本项目把同一个交互做成了**可保存的结构**：

- AI 自动按内容选 4 种构图（地图 / 图鉴 / 场景 / 剖面图）
- 命名好的热点，可拖、可改标签、可删
- 项目入 Postgres，跨设备同步
- 导出离线 ZIP / JSON / 公开分享链接

![demo](./flipbook-builder-demo.gif)

---

## 架构

```
┌──────────── 浏览器 ────────────┐
│  React 19 + Vite + Zustand    │   ← 状态、SSE、i18n（中/英）
└────────────┬───────────────────┘
             │ /api/*  /uploads/*
┌────────────▼───────────────────┐
│  nginx (静态 + 反代 + SSE)      │
└────────────┬───────────────────┘
             │
┌────────────▼───────────────────┐    ┌──────────────────┐
│  FastAPI + uvicorn             │ ─► │  Postgres 16     │
│  • input_analysis              │    │  (项目/节点/热点) │
│  • composition (map/plate/…)   │    └──────────────────┘
│  • image_generation (含缓存)   │
│  • hotspot_localization        │    ./data/
│  • SSE 流式生成                 │ ─► uploads/  img_cache/
└────────────────────────────────┘
        │
        ├─► Anthropic / OpenAI / OpenRouter（文本 + 视觉 LLM）
        └─► DALL-E 3 / Flux / GPT-Image（图片生成）
```

### 多 Agent 流水线

后端把"理解 → 规划 → 生成 → 标注"拆成 5 个职责单一的 agent，互相串成 SSE 流：

```
用户输入（图 / 文字 / 关键词）
        │
        ▼
┌─────────────────────┐
│ input_analysis      │  视觉 LLM 看图 → 输出 summary / scene_type / keywords
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ composition         │  按内容类型（地理/物种/事件/结构）路由 4 种 prompt 模板
│   • map             │
│   • plate (图鉴)    │  ← prose-style，DALL-E 3 友好
│   • scene           │
│   • diagram (剖面)  │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ page_generation     │  LLM 写每个子页的 title / description / 子热点
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ image_generation    │  DALL-E 3 / Flux 出图 +  SHA256 缓存（相同 prompt 跳过 API）
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ hotspot_localization│  视觉 LLM 在出好的图上标可点击区域（normalized [0,1] bbox）
└─────────────────────┘
```

每个 agent 都继承同一个 `BaseLLMAgent`，统一处理 Anthropic / OpenAI 兼容协议、prompt caching、错误重试、SSE 进度推送。

**关键设计：**
- **Prompt caching**：5 分钟内重复 system prompt 走缓存，并发生成 4 个子页时只第一次完整收费
- **图片缓存**：(model, prompt) SHA256 命中本地磁盘，跳过 API
- **构图路由 + prose prompt**：用 5-7 个描述词的散文，正向描述（避免 "MUST/NOT" —— DALL-E 3 反应不好）
- **Provider 抽象**：用户在浏览器填 key 就能用 Anthropic / OpenAI / OpenRouter / DeepSeek / 任意 OpenAI 兼容中转

---

## 部署

### 一键启动（推荐）

```bash
git clone <repo>
cd flipbook_builder
docker compose up -d --build
```

打开 http://localhost:8080 → 右上角「配置」填 API Key → 上传图片开始。

### 服务说明

| 容器 | 镜像 | 端口 | 作用 |
|---|---|---|---|
| `flipbook-frontend` | nginx:1.27-alpine | 8080→80 | 静态托管 + `/api` `/uploads` 反代 + SSE 长连接 |
| `flipbook-backend` | python:3.13-slim | 内部 8000 | FastAPI + uvicorn |
| `flipbook-db` | postgres:16-alpine | 5434→5432 | 项目数据持久化 |

数据卷：
- `./data/` — 上传图片 + 图片缓存（宿主机持久化）
- `postgres_data` — 数据库（docker volume）

### 常用命令

```bash
docker compose logs -f backend   # 查日志
docker compose ps                # 状态
docker compose down              # 停（保留数据）
docker compose down -v           # 停 + 清空所有数据
```

### 本地开发（不用容器）

```bash
# 后端
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --port 8000 --reload

# 前端
cd frontend && npm install && npm run dev
```

需要本地有一个 Postgres 实例（默认连 `localhost:5434`，可用 `docker compose up db` 单起）。

---

## 与同类项目客观对比

参考过两个相关项目，但走的路线不同：

| 维度 | [Flipbook](https://flipbook.page/) (Zain Shah) | [openflipbook](https://github.com/eren23/openflipbook) (eren23) | **本项目** |
|---|---|---|---|
| **形态** | 纯像素流，无 DOM | 同 Flipbook（Next.js 壳） | 结构化页面 + 可编辑热点 |
| **生成模型** | LTX Studio 视频模型（实时流） | fal-ai LTX video（每页 ~$0.02） | DALL-E 3 / Flux / GPT-Image（按张） |
| **交互** | 点击屏幕任意像素生成下一页 | 同左 | 点击 AI 识别并标注的具名热点 |
| **构图策略** | 单一风格（漫游感） | 同左 | 4 种构图按内容自动路由（地图 / 图鉴 / 场景 / 剖面图） |
| **可编辑** | ❌ 只读 | ❌ 只读 | ✅ 拖热点、改标签、删节点、勾选展开 |
| **持久化** | 服务端 session | Mongo + Cloudflare R2 | Postgres + 本地磁盘卷 |
| **导出 / 分享** | ❌ | 链接 (`/n/:id`) | ZIP 离线包 / JSON / 公开分享链接 |
| **项目管理** | ❌ | ❌ | ✅ 项目列表、缩略图、删除、跨设备 |
| **后端** | Modal Labs serverless GPU | Modal + R2 + Mongo | FastAPI + Postgres（自托管友好） |
| **多语言** | 英文 | 英文 | 中 / 英 |
| **定位** | 梦境式视觉漫游 | 同 Flipbook 的开源版 | 结构化的视觉知识工具 |

简单说：Flipbook / openflipbook 像 **TikTok**（无尽刷流，强调氛围感），本项目像 **Notion**（结构化、可编辑、可导出，适合做知识资产）。

---

## 未来迭代

- **v0.2** — 子页预加载（在用户停留 L1 时悄悄生成 L2 候选）
- **v0.3** — 翻页过渡用 LTX 之类的 image-to-video 模型，弥补静态图的呆板
- **v0.4** — 知识工具：对当前节点提问、跨节点搜索、导出为 Anki 卡片
- **v0.5** — 多人协作：实时光标 + 评论 + 节点 review
- **v0.6** — 一键部署到 Vercel / Fly.io / 自托管 docker-compose（带 https）

---

## 联系

对这个项目的实现细节、合作方向或类似问题感兴趣的，欢迎交流：

📧 yyb980716@gmail.com

也欢迎直接提 Issue / PR。

---

## License

MIT — 在符合 LICENSE 条款的前提下随意 fork / 改造 / 商用。

致谢：[Zain Shah](https://x.com/zainhda)（Flipbook 原作者）、[eren23](https://github.com/eren23)（openflipbook）以及启发"分层视觉知识"的 [David Macaulay](https://en.wikipedia.org/wiki/David_Macaulay) 与 DK Eyewitness 系列。
