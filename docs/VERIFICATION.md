# 验证与复测

更新于 2026-10-19。此页是当前可运行入口；[历史记录](archive/README.md)中的旧阶段数字、临时地址与已退役脚本不代表当前复测方式。

## 最近完整结果

第八轮新增独立[模型质量评估流程](MODEL_QUALITY.md)：固定中英文 6 案例、18 阶段。提交前清理后的评估测试为 94/94，Ruff 和两次完整回放、恢复、对比通过；新增负例覆盖损坏的本地运行、恢复配置和评审文件。六个作品输出与清理前逐项相同，数据集摘要不变。首次完整验收的 89/89、真实 Postgres 后端 290/290，以及桌面和 390px 报告检查保留原测量值。生产代码和前端产品没有改动，本次清理未重复完整发布浏览器流程。付费调用为 0，真实模型质量为未审，总分为空。详见[第八轮实施报告](ROUND_8_IMPLEMENTATION.md)与[机器证据](evidence/round8-verification.json)的 `pre_commit_cleanup`。

从根目录运行：

```sh
python -m pytest scripts/quality_eval/tests -q
python scripts/evaluate_quality.py run --output evals/runs/new-baseline
```

使用后端开发依赖，无需数据库或密钥；每次使用新的运行目录。人工评审和显式 live 额度见[运行手册](MODEL_QUALITY.md)。评估在本地运行，不配置收费模型凭据；GitHub Actions CI/CD 已移除。

## 产品流程的保留基线

第七轮的完整本地验收仍作为发布、历史、任务恢复与产品浏览器流程的基线：后端真实 Postgres 290/290、前端 299/299、发布与历史真实进程各 10/10、生成恢复 7/7、整栈 HTTP 19/19，双环境播放器、静态检查与四服务构建通过。独立 reader 在编辑后端和数据库停止后仍能提供三层作品与复制图片。实现、审查修复、桌面/390px 截图和限制见[第七轮报告](archive/ROUND_7_IMPLEMENTATION.md)。

[第七轮汇总](archive/evidence/round7-verification.json)保留完整结果，其 `pre_commit_cleanup` 另记当轮提交前复测：前端 299 项、后端发布专项 22 项、发布进程 10 场景及构建通过。原始数字未被后续结果覆盖；各项进程、浏览器与停库证据从报告进入。[历史索引](archive/README.md)保留更早记录，证据中的临时地址与测试数据库名不是部署配置。

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

不要把 pytest 指向包含真实作品的数据库。请自行准备隔离 Postgres 服务，自动化模型请求只访问受控供应商。

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

第七轮实际产品浏览器覆盖：三层知识作品及图片作品发布、草稿阻止、编辑/恢复后旧快照不变、新发布新链接、冻结播放器样式、独立 PNG、删除原作后全局撤下与双语 404，以及 390px 英文长列表。复制测试验证反馈及链接，不把桥接剪贴板读回当作操作系统剪贴板一致性的证明。流程记录与截图见[第七轮报告](archive/ROUND_7_IMPLEMENTATION.md)。

## 正式 Compose 与停库隔离

按[快速开始](../README.md#自托管完整-ai-流程)启动四服务后执行：

```sh
python scripts/verify_stack.py --base-url http://localhost:8080
```

脚本只操作自己新建的合成作品并清理。默认假供应商地址 `http://host.docker.internal:19091/v1` 适用于能通过该名称访问宿主机的容器环境；其他环境用 `--provider-url` 指定后端容器可达的本机测试地址。参数以 `--help` 为准。

独立 reader 隔离另在**专用测试 Compose 项目**验收：准备发布并记录全部公开文件哈希；停止该项目的 backend 和 db，确认均已退出且 reader 仍运行；实际浏览器刷新、三层导航和加载复制 PNG，并通过 HTTP 逐字节比较 HTML/JSON/JS/CSS/PNG；最后恢复编辑服务。不要停止无关容器。检查 reader 运行配置为非 root、只读根文件系统、仅发布目录只读挂载且无数据库/模型环境变量。第七轮 3 份发布均通过，证据见[停库隔离](archive/evidence/round7-isolation.json)。

## 证据和限制

当前进程验收扫描逻辑行、DBOS Base64 序列化、自己隔离库的原始关系文件、日志与资产，未发现合成 Key，负对照能检出误存 Key。扫描时允许 Postgres 正在清理的关系文件消失并记录数量，其余文件仍逐字节检查。审计未执行 `pg_dump`，也未读取无关数据库或整个集群 WAL。

已记录的自动化与产品浏览器模型请求均到本地受控供应商，真实付费请求为 0。它们证明结构、关系、恢复与发布行为，不证明知识正确性、参考资料真实支持正文或真实模型的速度/费用/跨页一致性。资料由作者填写，没有自动抓取或事实核验；混合恢复内容没有区块级出处。

历史不进入 JSON/ZIP 或固定发布。删原作会删除源历史，但保留独立发布；本地每页 50 版和服务器不主动裁剪均不能替代数据库、源图片与发布目录备份。快照限额不是压力测试；发布依赖本地 POSIX 文件锁与原子 rename。跨浏览器、真实辅助技术、浏览器 `file://` 双击、任意跨版本任务迁移、多副本和长期负载均未完整验证。本文记录的是本地验收结果。
