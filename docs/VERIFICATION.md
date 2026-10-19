# 验证与复测

更新于 2026-10-19。此页是当前可运行入口；[历史记录](archive/README.md)中的旧阶段数字、临时地址与已退役脚本不代表当前复测方式。

## 最近完整结果

第六轮完成页面草稿撤回、版本历史、真实合并预览、保留分支的恢复和项目修订冲突保护。以下为本轮最终本地结果；操作与审查修复见[实施报告](ROUND_6_IMPLEMENTATION.md)。模型请求均使用本地受控供应商。

| 验证 | 最近结果 | 覆盖 |
|---|---|---|
| 后端 pytest + 真实 Postgres | 268/268 | 内容与历史合约、API、关系、来源、任务恢复和安全边界 |
| 前端 Vitest | 34 文件、262/262 | 草稿撤回、原子本地历史、存储失败、合并预览、并发保存与恢复、渲染和导出 |
| Ruff、ESLint、TypeScript、正式 Docker 构建 | 通过 | 代码与 production 构建 |
| 独立播放器 | development / production 宿主均通过；198,984 bytes | 实际构建产物、JSDOM file URL 启动、三层往返、来源与核对 |
| 页面历史真实 HTTP / 进程 | 10/10 | 留版、预览、分支保护、恢复幂等、409、重启、归属与公开字段边界 |
| 生成真实进程恢复 | 7/7 | 两次 SIGKILL、知识正文、未知出图、格式失败、再生和图片上传 |
| nginx / FastAPI / Postgres HTTP | 19/19 | 正式三服务 API 与资源 |
| 实际浏览器编辑、恢复与导出 | 通过 | 本地跨页草稿、恢复保留子页、刷新与实际 ZIP；服务器两层分支、双标签 409/整作品重载/恢复再找回、三层阅读；图片键盘位置恢复；390px 英文无横溢 |
| 独立代码审查 | ship；2 项 P2 均已修复 | 快捷恢复先预览、合并后 13 热点拒绝 |

第六轮证据：[验证汇总](evidence/round6-verification.json)、[10 场景历史进程](evidence/round6-history-process.json)、[7 场景生成进程](evidence/round6-knowledge-process.json)、[19 项整栈](evidence/round6-postgres-stack.json)、[浏览器运行](evidence/round6-browser-runtime.json)、[导出检查](evidence/round6-browser-export.json)。界面快照见[桌面](images/round6-final-desktop-history.png)和[390px 手机](images/round6-final-mobile-history.png)。

早期验收及清理基线的原始数字见[历史索引](archive/README.md)。旧证据保留当时的测量上下文，不回写为当前结果；其中的隔离测试数据库名和临时 localhost 地址不是部署配置。

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

## 页面历史进程验收

在仓库根目录使用已安装后端开发依赖的 Python：

```sh
python scripts/verify_version_history.py \
  --database-url postgresql://flipbook:flipbook@localhost:5434/flipbook \
  --evidence /tmp/flipbook-history-acceptance-new.json
```

验证器启动正式 FastAPI/DBOS 与真实 Postgres，使用本地 HTTP 假供应商建立知识页和两层分支；中途重启后再次核对版本。覆盖生成根页基线、正文/资料与无操作去重、父子留版、只读合并预览、恢复新增版本且保留两层关系、幂等及陈旧编辑 409、找回恢复前内容并重置核对、重启持久化、跨项目/页面归属、历史白名单与导出排除，共 10 场景。

它与下方生成验证器共用 `scripts/durable_acceptance/harness.py`。传入 DSN 只用于创建随机隔离数据库，成功后删除自己创建的库；不会清空传入库。测试 role 需 `CREATEDB`，原始关系文件扫描还需测试超级用户或相应 `pg_ls_dir` / `pg_read_binary_file` 权限。证据路径应使用新文件名；成功后才写 JSON，失败时保留终端输出。

前端测试另外覆盖当前页撤回不影响其他草稿、本地每页 50 版、配额失败保留旧内容、预览与恢复排队、跨 workspace 迟到响应、冲突重载前先成功保留恢复副本。localStorage 不支持跨进程 compare-and-swap，测试不证明多标签同时写入的全局串行化或多人协作。

## 生成进程恢复验收

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

当前进程验收扫描逻辑行、DBOS Base64 序列化、当前隔离库的原始关系文件、日志与资产，未发现合成 Key，负对照能检出误存 Key。审计仅针对验证器自己的隔离环境；第五轮没有执行 `pg_dump` 扫描，也未读取无关数据库或整个集群 WAL。

全部自动化和本轮浏览器模型请求到本地受控供应商，真实付费请求为 0。它们证明结构、关系、恢复与导出行为，不证明知识正确性、参考资料真实支持正文或真实模型的速度/费用/跨页一致性。作者参考资料没有自动抓取或事实核验，混合恢复内容没有区块级出处。历史不进入 JSON/ZIP，删除作品会删除历史；本地每页 50 版与服务器不主动裁剪均不能替代数据库和图片备份。跨浏览器、真实辅助技术、任意跨版本任务迁移、多副本和长期负载均未完整验证。远端 GitHub Actions 是否通过，以对应提交的实际运行结果为准。
