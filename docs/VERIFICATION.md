# 验证与复测

更新于 2026-10-19。此页是当前可运行入口；[历史记录](archive/README.md)中的旧阶段数字、临时地址与已退役脚本不代表当前复测方式。

## 第十轮当前结果

本轮保持模型无关，不预置或绑定具体模型。默认 `legacy-v1`，`grounded-v2` / `focused-v3` 显式选择且服务环境默认关闭；候选先冻结，再打开独立保留集，保留集不修改。冻结依据见[计划](ROUND_10_PLAN.md)与[候选记录](evidence/round10-candidate-freeze.json)，交付与最终浏览器状态见[本轮实施](ROUND_10_IMPLEMENTATION.md)，完整本地结果见[机器证据](evidence/round10-verification.json)。

| 验证 | 当前结果 | 范围 |
|---|---|---|
| 后端真实隔离 Postgres | 434/434 | 默认兼容、修订冻结、上下文、坐标与任务/历史/发布 |
| 评估器 | 163 项、27 个 subtests 通过 | 恢复身份、合法/非法 bbox、显式上限、录制适配与受控 HTTP |
| 前端 | 37 文件、299/299 | 产品回归；lint、双环境播放器、生产与发布构建通过 |
| 真实进程 | 默认生成 7/7、focused-v3 生成 7/7、历史 10/10、发布 10/10 | 本地受控供应商与独立 Postgres |
| 正式 Compose | 构建/启动通过，HTTP 19/19 | 正式 nginx / FastAPI / Postgres / reader |
| 开发集与保留集回放 | 六组各 6 案例、18 阶段执行/自动检查通过 | 三修订 × 两套数据；显式图片上限 5 |
| 实际浏览器与隔离阅读 | 通过 | 三层生成、编辑/历史恢复、实际 ZIP 下载、文字/图片固定发布、390px 阅读、停库后独立阅读及文件一致性 |

已完成回放恢复不新增调用、输出字节保持；不同修订的受控内容/标签相同，坐标在等价转换容差内一致。这证明夹具适配和执行合约，**不证明真实模型质量改善**：六组 Agent 与人工均为 `not_reviewed`，真实模型调用 0。Ruff 通过。真实浏览器闭环也已完成；其通过只证明产品流程与隔离阅读，不转为模型质量评审。

第九轮原始真实基线与候选各 18 阶段、两侧各 6/6 Agent 失败、人工未审及分支不可直接比较，仍保留在[原报告](archive/ROUND_9_IMPLEMENTATION.md)和[原始证据](evidence/round9-verification.json)。其后端 314、评估器 148 等测量值不由本轮覆盖。

## 模型评估入口

从根目录运行：

```sh
python -m pytest scripts/quality_eval/tests -q
python scripts/evaluate_quality.py run --output evals/runs/new-baseline
```

使用后端开发依赖，无需数据库或密钥，每次使用新的运行目录。默认离线回放与 `legacy-v1`；显式修订、热点上限、独立保留集、恢复身份、Agent/人工评审及 live 额度统一见[质量评估手册](MODEL_QUALITY.md)。仓库不配置 GitHub Actions CI/CD。

## 历史结果

[历史索引](archive/README.md)集中保留第一至九轮计划、测量和失败，旧数字不由本轮结果覆盖。页面历史、独立固定发布与评估流程的初始验收分别见[第六轮](archive/ROUND_6_IMPLEMENTATION.md)、[第七轮](archive/ROUND_7_IMPLEMENTATION.md)和[第八轮](archive/ROUND_8_IMPLEMENTATION.md)。临时地址与数据库名是测量上下文，不是部署配置。

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

# 显式实验；仍只调用本地受控供应商
KNOWLEDGE_GENERATION_REVISION=focused-v3 python scripts/verify_knowledge_generation.py \
  --database-url postgresql://flipbook:flipbook@localhost:5434/flipbook \
  --evidence /tmp/flipbook-knowledge-focused-new.json
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

第十轮实际操作完成三层生成、标题编辑，并恢复最早版本且保留之后增加的 1 个分支；4 个生成任务冻结 `focused-v3` 与上下文，共 4 次假供应商请求、真实模型调用 0。通过界面实际下载 ZIP，独立检查其 3 节点、2 分支、本地播放器和无 Key；该数据核验不冒充浏览器 `file://` 播放。

分别发布三页文字作品与一页图片作品；390×844 阅读三层时页面宽度为 390、无横向溢出，质量报告正文宽度 375。停止本轮测试 API、假供应商以及专用 Compose 的 backend/db 后，实际刷新阅读器仍能三层导航并加载 800×500 PNG，9 个独立 reader HTTP 文件逐字节 SHA-256 一致。恢复 Compose 的 backend/db 健康后，再通过 UI 修改原稿，编辑前后发布文件仍逐字节相同。本轮临时测试服务和独立数据库均已清理；步骤与非敏感证据见[第十轮报告](ROUND_10_IMPLEMENTATION.md)和[验证汇总](evidence/round10-verification.json)。


## 正式 Compose 与停库隔离

按[快速开始](../README.md#自托管完整-ai-流程)启动四服务后执行：

```sh
python scripts/verify_stack.py --base-url http://localhost:8080
```

脚本只操作自己新建的合成作品并清理。默认假供应商地址 `http://host.docker.internal:19091/v1` 适用于能通过该名称访问宿主机的容器环境；其他环境用 `--provider-url` 指定后端容器可达的本机测试地址。参数以 `--help` 为准。

独立 reader 隔离另在**专用测试 Compose 项目**验收：准备发布并记录全部公开文件哈希；停止该项目的 backend 和 db，确认均已退出且 reader 仍运行；实际浏览器刷新、三层导航和加载复制 PNG，并通过 HTTP 逐字节比较 HTML/JSON/JS/CSS/PNG；最后恢复编辑服务。不要停止无关容器。检查 reader 运行配置为非 root、只读根文件系统、仅发布目录只读挂载且无数据库/模型环境变量。本轮两份发布、9 个公开文件均通过；最终记录见[验收证据](evidence/round10-verification.json)。早期停库测量见[第七轮证据](archive/evidence/round7-isolation.json)。

## 证据和限制

当前进程验收扫描逻辑行、DBOS Base64 序列化、自己隔离库的原始关系文件、日志与资产，未发现合成 Key，负对照能检出误存 Key。扫描时允许 Postgres 正在清理的关系文件消失并记录数量，其余文件仍逐字节检查。审计未执行 `pg_dump`，也未读取无关数据库或整个集群 WAL。

本轮自动化回归、评估与产品验收仅使用受控供应商，真实模型调用为 0。第九轮真实实验另存历史报告与原证据。功能检查证明结构、关系、恢复与发布行为，不证明知识正确性或模型质量、速度、费用；受控回放不得当作内容改进或自动事实核验。资料由作者填写，没有自动抓取或事实核验；混合恢复内容没有区块级出处。

历史不进入 JSON/ZIP 或固定发布。删原作会删除源历史，但保留独立发布；本地每页 50 版和服务器不主动裁剪均不能替代数据库、源图片与发布目录备份。快照限额不是压力测试；发布依赖本地 POSIX 文件锁与原子 rename。跨浏览器、真实辅助技术、浏览器 `file://` 双击、任意跨版本任务迁移、多副本和长期负载均未完整验证。本文记录的是本地验收结果。
