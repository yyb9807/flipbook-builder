# 验证与复测

更新于 2026-10-18。此页是当前可运行入口；[历史记录](archive/README.md)中的旧阶段数字、临时地址与已退役脚本不代表当前复测方式。

## 最近完整结果

本轮冗余清理后的本地结果如下。清理移除了旧 36 场景 CLI、独立 SQLite PoC 和未使用的生产 helper，并将当前进程验证的公共 Harness 归并到 `scripts/durable_acceptance/`；8 个只测试废弃 helper 的测试随之退役。第五轮原始 257 项结果仍保留在历史快照中，没有将删减误写成测试回退。完整操作、缺陷与修复过程见[实施报告](ROUND_5_IMPLEMENTATION.md)、[浏览器验收](ROUND_5_BROWSER_ACCEPTANCE.md)和[独立代码审查](ROUND_5_CODE_REVIEW.md)。

| 验证 | 最近结果 | 覆盖 |
|---|---|---|
| 后端 pytest + 真实 Postgres | 249/249 | 内容合约、API、关系、来源、任务恢复和安全边界 |
| 前端 Vitest | 30 文件、232/232 | 草稿、并发保存、任务、渲染、来源和导出 |
| Ruff、ESLint、TypeScript、production build | 通过 | 代码与构建 |
| 独立播放器 | development / production 宿主均通过 | 实际构建产物、JSDOM file URL 启动、三层往返、来源与核对 |
| 当前真实进程恢复 | 7/7 | 两次 SIGKILL、知识正文、未知出图、格式失败、再生和图片上传 |
| nginx / FastAPI / Postgres HTTP | 19/19 | 正式三服务 API 与资源 |
| 实际浏览器导出 | 26 项数据/安全检查通过 | 重新下载 ZIP、实际 HTTP 播放、三层导航与 390px 布局 |

本轮清理后的[验证汇总](evidence/cleanup-verification.json)、[7 场景进程复跑](evidence/cleanup-knowledge-process.json)与[19 项整栈复跑](evidence/cleanup-postgres-stack.json)记录当前代码结果。前端 30 文件、232 项与双环境播放器也再次通过；空 demo 启动/停止后完成审计和隔离库清理。

第五轮[进程证据](evidence/round5-knowledge-process.json)、[HTTP 证据](evidence/round5-postgres-stack.json)、[导出检查](evidence/round5-browser-export.json)、[浏览器运行审计](evidence/round5-browser-runtime.json)和[部署资产对照](evidence/round5-final-assets.json)记录当次实测快照。它们含隔离测试数据库名和临时 localhost 地址，不是部署配置。

## 前端

Node.js 24，在 `frontend/` 运行：

```sh
npm ci
npm run lint
npm test
npm run verify:player
npm run build
```

`verify:player` 在两个独立宿主环境中实际构建普通脚本，再运行生成的产物；它不是仅检查导出 JSON 或源代码。真实浏览器中的 `file://` 双击仍需另测，不能把 JSDOM 或 HTTP 预览当作相同验收。

## 后端

使用 Python 3.13、`backend/requirements-dev.txt` 和 PostgreSQL 16。按[后端说明](../backend/README.md)准备专用测试数据库后，在 `backend/` 运行：

```sh
ruff check .
DATABASE_URL=postgresql://flipbook:flipbook@localhost:5434/flipbook_test python -m pytest -q
```

不要把 pytest 指向包含真实作品的数据库。CI 提供隔离的 Postgres 服务，执行相同检查。

## 当前进程恢复验收

在仓库根目录使用已安装后端开发依赖的 Python：

```sh
python scripts/verify_knowledge_generation.py \
  --database-url postgresql://flipbook:flipbook@localhost:5434/flipbook \
  --evidence /tmp/flipbook-knowledge-acceptance-new.json
```

此入口运行正式 FastAPI、DBOS、agents 和 Postgres，仅用本地 HTTP 假供应商替代远端模型。公共测试操作位于 `scripts/durable_acceptance/harness.py`。传入管理 DSN，role 需要 `CREATEDB`；原始关系文件扫描需要测试超级用户或相应 `pg_ls_dir` / `pg_read_binary_file` 权限。验证器新建随机隔离数据库，成功结束时删除自己创建的库，不清空传入 DSN 的数据库。证据使用新文件名。此验证器的临时目录会在退出时清理（包括失败）；成功后才写证据 JSON，失败细节需保留终端输出。

| 场景 | 核心断言 |
|---|---|
| 根页分析后 SIGKILL | 复用完成的分析，不重复调用；正文和来源一起保存 |
| 子页规划后 SIGKILL | 缺 Key 等待，显式补 Key 后仅出图一次，无额外定位 |
| 下一层明确不配图 | 即使配置图片 Key，仍只生成文字 |
| 未知插图选择保留文字 | 保存已有正文，无隐式重调 |
| 无效正文 | 明确失败，不自动重试或继续出图 |
| 旧空白页再生 | 页面 ID 和作者资料保留，核对重置 |
| 上传图片分析 | 原图模式与真实热点保留 |

7 场景适配当前知识页默认合约，不等同于重新运行历史 17/36 场景。旧无标记任务、取消及更多恢复边界由后端测试补充覆盖。

供真实浏览器操作的本地 demo：

```sh
python scripts/verify_knowledge_generation.py \
  --database-url postgresql://flipbook:flipbook@localhost:5434/flipbook \
  --evidence /tmp/flipbook-knowledge-browser-new.json --demo --port 8000
```

demo 保留临时 API 和假供应商，并打印仅供该假供应商的合成 Key。在启动了 `npm run dev` 的前端中填写对应设置；向 demo 标准输入发送 `{"action":"stop"}` 后清理自己的进程和数据库。不要提供真实付费 Key。

## 整栈 HTTP 检查

先运行 `docker compose up -d --build`，再在仓库根目录执行：

```sh
python scripts/verify_stack.py --base-url http://localhost:8080
```

脚本只操作自己新建的合成作品，并清理这些作品；AI 探测使用脚本启动的本地假供应商。默认假供应商地址为 `http://host.docker.internal:19091/v1`，适用于可通过该名称访问宿主机的容器环境；其他环境使用 `--provider-url` 指定后端容器可达的本机测试地址。完整参数以 `python scripts/verify_stack.py --help` 为准。

## 证据和限制

进程验收扫描逻辑行、DBOS Base64 序列化、当前隔离库的原始关系文件、日志与资产，未发现合成 Key，负对照能检出误存 Key。第五轮没有执行 `pg_dump` 扫描，也未读取无关数据库或整个集群 WAL。

全部自动化和本轮浏览器模型请求到本地受控供应商，真实付费请求为 0。它们证明结构、关系、恢复与导出行为，不证明知识正确性、参考资料真实支持正文或真实模型的速度/费用/跨页一致性。作者参考资料没有自动抓取或事实核验。跨浏览器、真实辅助技术、任意跨版本任务迁移、多副本和长期负载均未完整验证。远端 GitHub Actions 是否通过，以对应提交的实际运行结果为准。
