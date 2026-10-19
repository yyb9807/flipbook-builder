# 验证与复测

更新于 2026-10-19。此页是当前可运行入口；[历史记录](archive/README.md)中的旧阶段数字、临时地址与已退役脚本不代表当前复测方式。

## 最近完整结果

第七轮完成独立只读发布、整树固定快照、独立图片与播放器、原操作安全重试，以及删源后的全局发布管理。以下为最终本地结果；实现及审查修复见[实施报告](ROUND_7_IMPLEMENTATION.md)。模型请求均使用本地受控供应商。

| 验证 | 最近结果 | 覆盖 |
|---|---|---|
| 后端 pytest + 真实 Postgres | 290/290 | 新增22项发布/reader回归；整树、资产、修订、幂等、并发、撤下、删源、路径及浏览器404 |
| 前端 Vitest | 37 文件、299/299 | 发布阻塞、原操作/修订跨重开重试、503忙、迟到响应、全局管理与既有编辑/恢复；最终布局修复后UI专项32/32 |
| Ruff、ESLint、TypeScript、正式 Docker 构建 | 通过 | 四服务 Compose、可信播放器构建、非root只读reader |
| 独立播放器 | development / production 宿主均通过；198,984 bytes | 实际构建产物、JSDOM file URL 启动、三层往返、来源与核对 |
| 固定发布真实 HTTP / 进程 | 10/10 | 三层快照、来源与私有排除、图片复制、幂等/409、重启、删源、撤下不复活及编辑/供应商停止 |
| 页面历史真实 HTTP / 进程 | 10/10 | 留版、预览、分支保护、恢复幂等、409、重启、归属与公开字段边界 |
| 生成真实进程恢复 | 7/7 | 两次 SIGKILL、知识正文、未知出图、格式失败、再生和图片上传 |
| nginx / FastAPI / Postgres HTTP | 19/19 | 正式编辑服务 API 与资源回归 |
| 正式容器隔离 | 通过 | backend和db均exited时，reader仍running；3份发布的HTML/JSON/JS/CSS/PNG全部字节哈希一致，无DB/模型环境且仅只读发布挂载 |
| 实际浏览器 | 通过 | 三层作品发布A、草稿阻止、修改/恢复、新版B、旧内容/核对/样式不变、独立图片、删源、停库三层导航、全局撤下与双语404；390px英文长列表 |
| 独立审查 | ship | 并发忙响应保留幂等ID；阅读器body边距和手机根滚动条布局修复已确认 |

第七轮证据：[汇总](evidence/round7-verification.json)、[发布进程](evidence/round7-publication-process.json)、[历史进程](evidence/round7-history-process.json)、[生成进程](evidence/round7-knowledge-process.json)、[整栈](evidence/round7-postgres-stack.json)、[停库隔离](evidence/round7-isolation.json)、[浏览器](evidence/round7-browser.json)。截图见[桌面发布](images/round7-desktop-publish.png)、[手机发布记录](images/round7-mobile-library.png)和[手机阅读](images/round7-mobile-reader.png)。[第六轮报告](archive/ROUND_6_IMPLEMENTATION.md)和原始证据保留当时测量值。

早期验收及清理基线的原始数字见[历史索引](archive/README.md)。旧证据保留当时的测量上下文，不回写为当前结果；其中的隔离测试数据库名和临时 localhost 地址不是部署配置。

提交前清理后另行复核：前端37文件299项、后端发布专项22项、发布真实进程10场景，以及lint、类型、无警告production构建与正式四服务重建均通过。可信播放器JS/CSS字节不变；4个线上前端资源与本地构建一致。归档的6份第六轮原始JSON与原提交逐字节一致。新测量追加在[汇总](evidence/round7-verification.json)的`pre_commit_cleanup`，原完整验收值保持不变。

## 本地检查

使用 Node.js 24、Python 3.13 和 PostgreSQL 16；安装与本地启动见[前端](../frontend/README.md)和[后端](../backend/README.md)说明。

在 `frontend/` 运行：

```sh
npm ci
npm run lint
npm test
npm run verify:player
npm run build
```

`verify:player` 在 development / production 两个宿主环境中构建播放器，并在 JSDOM file URL 下执行实际普通脚本产物，覆盖三层导航、来源与作者核对。它不能替代真实浏览器的 `file://` 双击验收。

在 `backend/` 安装 `requirements-dev.txt` 并预先创建专用测试数据库，然后运行：

```sh
ruff check .
DATABASE_URL=postgresql://flipbook:flipbook@localhost:5434/flipbook_test python -m pytest -q
```

不要把 pytest 指向包含真实作品的数据库。CI 提供隔离 Postgres 服务，自动化模型请求只访问受控供应商。

## 真实进程验收

下列命令从仓库根目录运行，使用已安装后端开发依赖的 Python。`--database-url` 是**测试管理 DSN**：验证器创建随机隔离库，结束时删除自己的库，不清空传入库。role 需 `CREATEDB`；原始关系文件审计还需测试超级用户或相应 `pg_ls_dir` / `pg_read_binary_file` 权限。公共支持在 `scripts/durable_acceptance/`，不要并行共用同一个手动创建的测试库。

每次使用新的证据文件名；成功后才写 JSON，失败时保留终端输出。验证器退出时清理临时进程与文件。所有模型请求使用本地 HTTP 假供应商，无需真实 Key。

```sh
# 固定发布先构建可信播放器
npm --prefix frontend ci
npm --prefix frontend run build:publication
python scripts/verify_publications.py \
  --database-url postgresql://flipbook:flipbook@localhost:5434/flipbook \
  --evidence /tmp/flipbook-publications-new.json

python scripts/verify_version_history.py \
  --database-url postgresql://flipbook:flipbook@localhost:5434/flipbook \
  --evidence /tmp/flipbook-history-new.json

python scripts/verify_knowledge_generation.py \
  --database-url postgresql://flipbook:flipbook@localhost:5434/flipbook \
  --evidence /tmp/flipbook-knowledge-new.json
```

| 入口 | 场景与主要断言 |
|---|---|
| `verify_publications.py` | 10 场景：三层关系/来源、私有字段排除、图片复制、幂等/陈旧修订、编辑/恢复后字节不变、新发布新链接、重启、缺图拒绝、删源、读者路径/方法与撤下不复活，以及编辑/供应商停止后的阅读 |
| `verify_version_history.py` | 10 场景：基线与内容去重、父子留版、合并预览、保护两层分支、恢复幂等/409、找回恢复前内容/核对重置、重启、归属与公开字段边界 |
| `verify_knowledge_generation.py` | 7 场景：根页/子页阶段后各一次 SIGKILL、显式无图、未知出图保留正文、无效正文失败、旧空白页再生与图片上传；不等同于已退役的历史 17/36 场景 |

后端测试补充旧任务路径、取消及更多恢复边界；前端测试补充草稿作用域、本地每页 50 版与配额失败、保存/恢复排队、跨工作区迟到响应、冲突重载前备份，以及未知发布结果保留原操作。localStorage 没有跨进程 compare-and-swap，这些测试不证明多人协作或同时写入全局串行化。

## 浏览器验收

为实际 UI 操作准备临时 API 与假供应商：

```sh
python scripts/verify_knowledge_generation.py \
  --database-url postgresql://flipbook:flipbook@localhost:5434/flipbook \
  --evidence /tmp/flipbook-knowledge-browser-new.json --demo --port 8000
```

保持标准输入可用，再启动前端 `npm run dev`。demo 打印假供应商地址与合成 Key，在模型设置填写；向 demo 标准输入发送 `{"action":"stop"}` 后清理自己的进程和数据库。不要提供真实付费 Key。

本轮实际浏览器覆盖：三层知识作品及图片作品发布、草稿阻止、编辑/恢复后旧快照不变、新发布新链接、冻结播放器样式、独立 PNG、删除原作后全局撤下与双语 404，以及 390px 英文长列表。复制测试验证反馈及链接，不把桥接剪贴板读回当作操作系统剪贴板一致性的证明。流程记录与截图见[第七轮报告](ROUND_7_IMPLEMENTATION.md)。

## 正式 Compose 与停库隔离

按[快速开始](../README.md#自托管完整-ai-流程)启动四服务后执行：

```sh
python scripts/verify_stack.py --base-url http://localhost:8080
```

脚本只操作自己新建的合成作品并清理。默认假供应商地址 `http://host.docker.internal:19091/v1` 适用于能通过该名称访问宿主机的容器环境；其他环境用 `--provider-url` 指定后端容器可达的本机测试地址。参数以 `--help` 为准。

独立 reader 隔离另在**专用测试 Compose 项目**验收：准备发布并记录全部公开文件哈希；停止该项目的 backend 和 db，确认均已退出且 reader 仍运行；实际浏览器刷新、三层导航和加载复制 PNG，并通过 HTTP 逐字节比较 HTML/JSON/JS/CSS/PNG；最后恢复编辑服务。不要停止无关容器。检查 reader 运行配置为非 root、只读根文件系统、仅发布目录只读挂载且无数据库/模型环境变量。本轮 3 份发布均通过，证据见[停库隔离](evidence/round7-isolation.json)。

## 证据和限制

当前进程验收扫描逻辑行、DBOS Base64 序列化、自己隔离库的原始关系文件、日志与资产，未发现合成 Key，负对照能检出误存 Key。扫描时允许 Postgres 正在清理的关系文件消失并记录数量，其余文件仍逐字节检查。审计未执行 `pg_dump`，也未读取无关数据库或整个集群 WAL。

全部自动化和本轮浏览器模型请求到本地受控供应商，真实付费请求为 0。它们证明结构、关系、恢复与发布行为，不证明知识正确性、参考资料真实支持正文或真实模型的速度/费用/跨页一致性。资料由作者填写，没有自动抓取或事实核验；混合恢复内容没有区块级出处。

历史不进入 JSON/ZIP 或固定发布。删原作会删除源历史，但保留独立发布；本地每页 50 版和服务器不主动裁剪均不能替代数据库、源图片与发布目录备份。快照限额不是压力测试；发布依赖本地 POSIX 文件锁与原子 rename。跨浏览器、真实辅助技术、浏览器 `file://` 双击、任意跨版本任务迁移、多副本和长期负载均未完整验证。远端 GitHub Actions 是否通过，以对应提交的实际运行结果为准。
