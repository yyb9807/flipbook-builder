# 验证与复测

更新于 2026-10-19。此页是当前可运行入口；[历史记录](archive/README.md)中的旧阶段数字、临时地址与已退役脚本不代表当前复测方式。

## 第十一轮结果

本轮增加模型无关的 Wikipedia 中英文来源检索、作者保存摘录、区块引用和工作台 UX/UI 整理，没有新增具体模型接入，真实模型调用为 0。实施与边界见[本轮报告](ROUND_11_IMPLEMENTATION.md)，原始计划见[计划](ROUND_11_PLAN.md)，非敏感结果和最终界面确认见[机器证据](evidence/round11-verification.json)。

| 验证 | 当前结果 | 范围 |
|---|---|---|
| 后端真实隔离 Postgres | 576 项通过 | 来源边界、原子引用/核对/历史/发布和既有任务兼容 |
| 前端 | 41 文件、341 项通过 | lint、生产/发布构建、双宿主环境离线播放器通过 |
| 评估器 | 163 项、27 个 subtests 通过 | 既有评估合约回归；未开展真实模型质量评估 |
| 真实进程 | 默认生成 7、focused-v3 生成 7、历史 10、发布 10、来源 13 场景通过 | 本地受控供应商、原创引用素材和隔离 Postgres |
| 正式 Compose | 构建/启动通过，HTTP 19 项通过 | UI 修复后仅更新 frontend，限流回归后仅更新 backend；分别核对部署摘要并保留其余服务 |
| 公共来源 | 中英文 search/page 与 nginx 英文来源接口均 200 | 只证明当时连通；不核验来源内容 |
| 实际浏览器 | 核心闭环通过 | 免模型创作、真实来源/双区块关联、引用/返回焦点、ZIP 实际下载、历史保留较新分支与来源、固定发布及停库独立引用阅读 |

实际 ZIP 含两条各 3000 字符的公共来源摘录及许可/版本。另一个四页三层受控作品在原稿标题/摘录后改、API/provider/专用数据库停止期间，旧发布四个公开文件逐字节 SHA-256 一致，独立 reader 重新加载并读取引用通过；测试服务随后恢复。公网资料和原创受控摘录分开，功能通过不代表事实核验或模型质量改善。

独立完成审查的预览关闭焦点、sticky 背板与英文提示发现已集中修复，并增加 8 项测试；最终桌面/390px 中英文确认和独立完成审查通过，结论为 release-ready；来源并发冷却补充负例先失败后通过，来源测试最终 77 项。机械设计检测空发现不等于完整无障碍认证。实际浏览器 `file://` 打开被 IAB 协议策略拒绝，未绕过，该项未执行；JSDOM file URL 检查不能替代跨浏览器双击验收。

## 既有质量基线与冻结记录

第十轮的候选冻结、六组受控回放与人工未审状态保留在[当轮报告](archive/ROUND_10_IMPLEMENTATION.md)、[候选记录](evidence/round10-candidate-freeze.json)和[当轮证据](evidence/round10-verification.json)。其旧测试数字不作为本轮复测；本轮也没有重新调优开发集或保留集。

第九轮原始真实基线与候选各 18 阶段、两侧各 6/6 Agent 失败、人工未审及分支不可直接比较，仍保留在[原报告](archive/ROUND_9_IMPLEMENTATION.md)和[原始证据](evidence/round9-verification.json)。这些质量结论不由本轮功能测试覆盖。

## 模型评估入口

从根目录运行：

```sh
python -m pytest scripts/quality_eval/tests -q
python scripts/evaluate_quality.py run --output evals/runs/new-baseline
```

使用后端开发依赖，无需数据库或密钥，每次使用新的运行目录。默认离线回放与 `legacy-v1`；显式修订、热点上限、独立保留集、恢复身份、Agent/人工评审及 live 额度统一见[质量评估手册](MODEL_QUALITY.md)。仓库不配置 GitHub Actions CI/CD。

## 历史结果

[历史索引](archive/README.md)集中保留第一至十轮计划、测量和失败，旧数字不由本轮结果覆盖。页面历史、独立固定发布与评估流程的初始验收分别见[第六轮](archive/ROUND_6_IMPLEMENTATION.md)、[第七轮](archive/ROUND_7_IMPLEMENTATION.md)和[第八轮](archive/ROUND_8_IMPLEMENTATION.md)。临时地址与数据库名是测量上下文，不是部署配置。

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
python scripts/verify_source_citations.py \
  --database-url postgresql://flipbook:flipbook@localhost:5434/postgres \
  --evidence /tmp/flipbook-source-citations-new.json

python scripts/verify_publications.py \
  --database-url postgresql://flipbook:flipbook@localhost:5434/flipbook \
  --evidence /tmp/flipbook-publications-new.json

python scripts/verify_version_history.py \
  --database-url postgresql://flipbook:flipbook@localhost:5434/flipbook \
  --evidence /tmp/flipbook-history-new.json

python scripts/verify_knowledge_generation.py \
  --database-url postgresql://flipbook:flipbook@localhost:5434/flipbook \
  --evidence /tmp/flipbook-knowledge-new.json

# 显式实验；仍只调用本地受控供应商
KNOWLEDGE_GENERATION_REVISION=focused-v3 python scripts/verify_knowledge_generation.py \
  --database-url postgresql://flipbook:flipbook@localhost:5434/flipbook \
  --evidence /tmp/flipbook-knowledge-focused-new.json
```

| 入口 | 场景与主要断言 |
|---|---|
| `verify_source_citations.py` | 13 场景：参数拒绝、受控三层页、原子保存/解除/删除保护、来源摘要与核对、历史保留新分支依赖/同 ID 副本冲突无写入、JSON/后端 ZIP/固定发布、编辑后字节不变、停 API/供应商后独立引用阅读与凭据审计；原创受控摘录、公网检索和真实模型调用均为 0 |
| `verify_publications.py` | 10 场景：三层关系/来源、私有字段排除、图片复制、幂等/陈旧修订、编辑/恢复后字节不变、新发布新链接、重启、缺图拒绝、删源、读者路径/方法与撤下不复活，以及编辑/供应商停止后的阅读 |
| `verify_version_history.py` | 10 场景：基线与内容去重、父子留版、合并预览、保护两层分支、恢复幂等/409、找回恢复前内容/核对重置、重启、归属与公开字段边界 |
| `verify_knowledge_generation.py` | 7 场景：根页/子页阶段后各一次 SIGKILL、显式无图、未知出图保留正文、无效正文失败、旧空白页再生与图片上传；不等同于已退役的历史 17/36 场景 |

`tests/test_source_retrieval.py` 使用显式 MockTransport 验证固定域名/路径、纯文本与上下标/公式替代文字、缓存、排队总截止、响应大小、限流和错误，不访问公网。真实公共来源连通性另行小量实测，不能用受控素材代替，也不能将检索结果记为事实已核验。

后端测试补充旧任务路径、取消及更多恢复边界；前端测试补充草稿作用域、本地每页 50 版与配额失败、保存/恢复排队、跨工作区迟到响应、冲突重载前备份，以及未知发布结果保留原操作。localStorage 没有跨进程 compare-and-swap，这些测试不证明多人协作或同时写入全局串行化。

## 浏览器验收

为实际 UI 操作准备临时 API 与假供应商：

```sh
python scripts/verify_knowledge_generation.py \
  --database-url postgresql://flipbook:flipbook@localhost:5434/flipbook \
  --evidence /tmp/flipbook-knowledge-browser-new.json --demo --port 8000
```

保持标准输入可用，再启动前端 `npm run dev`。demo 打印假供应商地址与合成 Key，在「AI 服务」设置填写；向 demo 标准输入发送 `{"action":"stop"}` 后清理自己的进程和数据库。不要提供真实付费 Key。

第十一轮实际浏览器用本地手动作品完成两段正文、中文/英文公共检索、摘录预览、同一来源关联两个区块、保存、引用跳转/返回焦点与 ZIP 下载。ZIP 独立检查保留 2 条各 3000 字符摘录及许可/版本。受控 502 响应下，查询、已有资料和草稿仍保留。

另一份服务器作品由本地假供应商生成 4 页 3 层，资料为原创受控摘录。实际恢复引用初稿时保留 1 条较新分支及其来源；发布后修改原稿标题/摘录，旧发布四文件逐字节一致；停止专用编辑 API、供应商与数据库后，浏览器重新加载独立 reader 仍可读三层引用/摘录并返回区块。步骤和最终截图以[本轮报告](ROUND_11_IMPLEMENTATION.md)与[机器证据](evidence/round11-verification.json)为准。真实浏览器 file:// 打开被 IAB 协议策略拒绝，未执行该入口；双宿主环境播放器仅在 JSDOM file URL 下验证。

## 正式 Compose 与停库隔离

按[快速开始](../README.md#自托管完整-ai-流程)启动四服务后执行：

```sh
python scripts/verify_stack.py --base-url http://localhost:8080
```

脚本只操作自己新建的合成作品并清理。默认假供应商地址 `http://host.docker.internal:19091/v1` 适用于能通过该名称访问宿主机的容器环境；其他环境用 `--provider-url` 指定后端容器可达的本机测试地址。参数以 `--help` 为准。

独立 reader 隔离另在**专用测试 Compose 项目**验收：准备发布并记录全部公开文件哈希；停止该项目的 backend 和 db，确认均已退出且 reader 仍运行；实际浏览器重新加载、三层导航、引用与摘录跳转，并通过 HTTP 逐字节比较 HTML/JSON/JS/CSS；有图片的作品另核对复制 PNG；最后恢复编辑服务。不要停止无关容器。检查 reader 运行配置为非 root、只读根文件系统、仅发布目录只读挂载且无数据库/模型环境变量。本轮四页文字发布的四公开文件通过，最终记录见[本轮证据](evidence/round11-verification.json)。第十轮图片与九公开文件结果见[当轮报告](archive/ROUND_10_IMPLEMENTATION.md)，早期停库测量见[第七轮证据](archive/evidence/round7-isolation.json)。

## 证据和限制

当前进程验收扫描逻辑行、DBOS Base64 序列化、自己隔离库的原始关系文件、日志与资产，未发现合成 Key，负对照能检出误存 Key。扫描时允许 Postgres 正在清理的关系文件消失并记录数量，其余文件仍逐字节检查。审计未执行 `pg_dump`，也未读取无关数据库或整个集群 WAL。

本轮自动化回归、评估与产品验收仅使用受控供应商，真实模型调用为 0。第九轮真实实验另存历史报告与原证据。功能检查证明结构、关系、恢复与发布行为，不证明知识正确性或模型质量、速度、费用；受控回放不得当作内容改进或自动事实核验。来源按作者操作检索固定 Wikipedia API，手填网址不抓取；摘录为可编辑作者副本，摘要不是认证回执，区块引用不代表已核验支持关系。混合恢复的生成说明仍是页面级，不提供模型生成的逐句溯源。

历史不进入 JSON/ZIP 或固定发布。删原作会删除源历史，但保留独立发布；本地每页 50 版和服务器不主动裁剪均不能替代数据库、源图片与发布目录备份。快照限额不是压力测试；发布依赖本地 POSIX 文件锁与原子 rename。跨浏览器、真实辅助技术、浏览器 `file://` 双击、任意跨版本任务迁移、多副本和长期负载均未完整验证。本文记录的是本地验收结果。
