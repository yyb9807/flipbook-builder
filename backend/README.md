# 后端开发与验证

后端使用 Python 3.13、FastAPI 与 PostgreSQL 16。开发检查在本地使用开发依赖运行；运行依赖已固定直接版本。

## 启动

下面的命令从仓库根目录执行。需要已启动的 Docker，或另行准备 PostgreSQL：

```sh
python3.13 -m venv backend/.venv
source backend/.venv/bin/activate
python -m pip install -r backend/requirements-dev.txt
cp .env.example backend/.env

docker compose up -d db
cd backend
uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1 --timeout-graceful-shutdown 5
```

`backend/.env` 的默认数据库连接是 `postgresql://flipbook:flipbook@localhost:5434/flipbook`。如果更改 Compose 的数据库用户名、密码、库名或端口，请同步修改连接地址。启动时获取 Postgres advisory 独占锁，再自动应用可重复执行的 `schema.sql` 和 DBOS 系统迁移；DBOS 系统表使用同库的 `dbos` schema。部署数据库用户需要创建 schema/table 的权限。服务明确只支持一个 Uvicorn worker / 一个副本，第二个执行器会拒绝启动。推荐命令与 Docker 启动均将 Uvicorn 优雅关闭等待限制为 5 秒，避免未关闭的 SSE 长订阅一直挡住 lifespan 清理；关闭只取消本地协程，持久任务仍可重启恢复。独占锁连接丢失时服务停止，交给进程监督器重启。原有页面数据保留。不要将 `.env` 或真实密钥提交到仓库。

浏览器开发前端使用 `http://localhost:5173` 或 `http://127.0.0.1:5173`。`CORS_ORIGIN` 支持用逗号列出地址；同源反向代理部署不需要通配 CORS。

## 测试

在 `backend/` 中运行：

```sh
ruff check .

# 不需要数据库、真实密钥或网络服务
python -m pytest tests/test_security.py tests/test_node_integrity.py tests/test_hotspot_localization.py tests/test_image_generation.py tests/test_composition.py tests/test_sse.py -q

# 包含真实 Postgres 集成测试：必须先配置独立测试数据库
DATABASE_URL=postgresql://flipbook:flipbook@localhost:5434/flipbook_test python -m pytest -q
```

`flipbook_test` 需预先创建。全量测试会写入临时项目并清理，请自行准备专用的隔离 Postgres 测试数据库；本地没有数据库时运行上面的无数据库测试集即可。所有自动化测试均不调用付费模型。

## 配置与数据边界

- 默认免账号、单实例共享工作区。能访问编辑 API 的人能够操作其中的作品；`/v/{pid}` 当前实例预览不构成访问权限隔离。公开读者使用独立 reader 或离线静态作品。
- 供应商的 URL、Key、model 作为一组选择。请求带任意一项供应商配置头时，整个供应商使用请求配置，缺少的 Key 保持空；只有完全没有该组配置头时，才使用部署环境配置。
- 自定义 HTTP(S) 地址支持本地模型。服务地址不能包含 URL 凭据、查询参数或片段。不要对不受信任的访客公开持有部署密钥的编辑实例。
- 图片上传最多 20 MB，只接受实际可解码的 JPG、PNG、WEBP 静态图，最大 4000 万像素、单边 12000 像素。服务器统一重编码为 PNG、去除元数据并生成不可变文件地址；ASGI 层另设 22 MB 总请求限额，在 multipart 解析前限制带或不带 Content-Length 的请求。不能仅凭文件后缀或 MIME 判断图片安全。
- `PATCH /api/projects/{project_id}/nodes/{node_id}` 修改标题、说明、可选的 `scene_document` 与节点级 `content_metadata`，支持可选 `expected_revision`。SceneDocument v1支持`atlas`/`sequence`和最多12个分区；新增区块原子创建真实section连接，回填hotspot_id，改名同步连接；有子页的区块不能直接删除或改指目标。设scene为null只有不破坏已链接区块时才允许。API返回规范scene、hotspots、metadata及确认后的`project_revision`，客户端应采用真实连接ID。
- `POST /api/projects/{project_id}/nodes/{node_id}/hotspots` 在图片模式中手动添加矩形热点；最多12个，返回选中但未链接的热点，不伪造模型置信度。结构化知识页返回409，应通过正文区块建立连接。`kind=section`的位置、尺寸与评分为空；旧记录默认`kind=image`，保留原几何。
- 新主题页、子页和可再生旧页使用同一次内容模型调用输出标题、导读和1–6个解释区块，后端严格校验，ID与目标由服务端建立。新任务冻结`knowledge-v1`/`image-v1`；无marker的历史任务沿用旧路径和checkpoint步序。知识页可不出图，有图也不额外定位；上传图片继续使用分析中的真实图像坐标。旧无marker流程仍保留真实图像定位，非法或失败结果为空，不补假评分。
- `content_metadata` v1包含服务端provenance（AI输入类型及模型）、最多12条作者references（标题≤200字、可选URL≤2000字、说明≤1000字）与review_status。URL仅允许无凭据的绝对HTTP(S)，不自动抓取。编辑不允许新增/修改/删除服务端provenance；正文、资料或热点文字变化清除旧核对，作者可以同批明确重新声明。模型回复的来源、核实声明和链接身份均被忽略，不能把格式通过当作事实核实。
- 子页生成逐页提交，单个子页失败时保留已完成的其他子页并返回 `warnings`、`failed_hotspot_ids`。重新尝试会跳过已有目标页面的热点。有任何热点或结构化正文的页面禁止整页重新生成，防止破坏坐标、导航与作者内容。页面版本恢复已实现，但没有逐字段差异比较或关联重定位。
- 三种生成均接入 DBOS 3.3.0 与真实 Postgres，创建接口见下表。`GET /api/projects/{pid}/jobs?active=true`、`GET /api/jobs/{jid}` 和 `/events?after={event_id}` 读取恢复状态，不发送 Key。`active=false&operation_id=...` 精确找回初次响应丢失的操作。SSE 断开只断订阅；显式 `/cancel` 才取消业务任务。
- 单个任务按选中连接顺序逐页规划、可选出图和提交，各远端阶段checkpoint；仅旧图片流程执行定位。业务任务创建和DBOS入队在同一个Postgres事务；正文、连接、来源及进度也在短事务内幂等提交。已完成页面不会因另一页失败而丢失；重复提交先查既有操作，再检查父页状态。正文格式错误是已知失败，不自动重新付费生成。
- 原始 Key 仅存进程内 vault，30 分钟过期、最多 100 份，取消/终态清理。重启后需要 Key 的阶段会暂停，用户通过 `/credentials` 显式提供与原服务地址/模型绑定的凭据；不能把 Key 放进 DBOS 参数、消息、结果或日志。DBOS 默认 Base64 序列化不是加密，作品内容与公开 provider 元数据仍是数据库中的普通应用数据。
- 所有持久流程的远端调用只尝试一次，关闭 Agent、SDK 与 Flux 参数降级重试。远端成功但本地结果丢失时暂停待确认，`/retry` 明确允许可能重复计费的下一次尝试；`/accept` 可保留已完成文字页或已有图片，`/cancel` 保留成功页面。接口使用单次 `confirmation_id`，过期/重复确认不会重复调用。
- 普通数据库连接/序列化/死锁错误只重试本地写入，不重新调用供应商。极端执行器代码错误且仍有未确认 intent 时，任务保持锁定、禁止再次调用，显示 `can_retry=false`；需核实后明确取消再重建，暂不自动修复已经失败的 DBOS step。取消无法撤销供应商已收到请求的费用。
- 同一作品的新活动任务互斥。编辑、热点写入与删除在 project → node → job 一致锁顺序下检查活动任务，返回409时需先完成或取消任务。升级前已存在的不同节点并行任务继续恢复，不通过新增唯一索引或擅自取消来清理。独立 PoC 与旧 36 场景 CLI 已退役，仅保留历史记录；当前进程验证使用 `scripts/verify_knowledge_generation.py`。
- 新前端离线导出复用共享 React 播放器。后端 `export.zip` 保留兼容，安全嵌入数据并降级展示结构化页面的文字和链接；JSON 导出保留原始结构化数据。JSON/ZIP 都不包含页面历史。

`KNOWLEDGE_GENERATION_REVISION` 未设置或留空时继续原行为（评估 CLI 中称为 `legacy-v1`）。仅显式设置 `grounded-v2` 或 `focused-v3` 才启用实验：新任务在接收时冻结修订、有界原始素材与分支上下文，恢复不读后来页面或环境。其他非空值（包括 `legacy-v1`）令新任务返回 503；原操作幂等回执优先返回。Compose 默认不传实验变量，显式试验需覆盖 backend environment，恢复默认应移除或留空。

两项实验均默认关闭，不预置或按名称判断具体模型。`focused-v3` 图片协议为 `bbox_2d=[left,top,right,bottom]`、0–1000 相对坐标；转换后才进入现有 xywh 流程，拒绝混合字段、非法、倒置、越界和非有限框，不猜格式、不后验修框或补请求。旧修订保持原协议和请求字节。任务格式标记、DBOS 名称、旧步骤顺序与 markerless 兼容保持不变。

评估 CLI 独立于服务环境，使用同一生产 Agent；修订、热点上限、源码/评估器摘要和恢复身份等参数见[质量评估手册](../docs/MODEL_QUALITY.md)。本轮受控结果不构成真实质量通过，当前数字与流程证据见[验证说明](../docs/VERIFICATION.md)。

## 页面历史接口与并发

下列路径均包含 `/api` 前缀。版本只属于指定项目和页面，跨归属读取或恢复返回 404。

| 接口 | 请求与响应 |
|---|---|
| `GET /projects/{pid}/nodes/{nid}/versions` | 返回 `{project_revision, current_version_id, versions}`；版本按 `sequence` 降序排列 |
| `GET /projects/{pid}/nodes/{nid}/versions/{vid}` | 返回 `{project_revision, version, preview, preserved_branch_count}`；`preview` 是与当前连接合并后的只读页面，并非直接返回历史快照 |
| `POST /projects/{pid}/nodes/{nid}/versions/{vid}/restore` | JSON 必填 `{operation_id, expected_revision}`；返回 `{project_revision, node, restored_version_id, preserved_branch_count}` |

列表中的版本摘要和详情中的 `version` 均为 `{id, sequence, reason, created_at, summary}`；`summary` 包含 `title`、最多 240 字的 `description`、`section_count`、`hotspot_count`。`current_version_id` 标识当前最新内容版本，服务端摘要没有 `is_current` 字段。`preview` / `node` 包含 `id`、当前 `parent_id`、`depth`、`status`、`children` 与页面内容字段。`preserved_branch_count` 统计为保护当前连接而保留的较新连接数量。

恢复体严格拒绝额外字段。`operation_id` 长度 1–100，只允许英文字母、数字、下划线和连字符；`expected_revision` 为非负整数。同项目内相同操作 ID、页面、版本和预期修订的重放返回原回执，不重复写入；相同 ID 携带不同参数返回 409。活动任务、陈旧修订、合并超出 12 区块/热点或图片资产缺失也拒绝恢复。前端在恢复后重新读取整份项目，不能将较早操作的幂等回执当作当前最新内容。

普通页面修改、热点创建和批量热点修改的 `expected_revision` 可选，兼容旧客户端；新编辑器均携带该值。热点创建在返回的热点中附 `project_revision`，批量热点修改返回 `{status, content_metadata, project_revision}`；项目读取的 `revision` 是下一次写入使用的确认修订。纯热点选择推进项目修订，但不产生内容版本。冲突返回 409，客户端保留草稿/预览，明确重新载入最新整份项目后再操作，不自动重试覆盖。

`version_history.py` 在普通编辑、资料核对、热点内容/几何修改及生成的同一事务中留存白名单快照；生成子页同时记录父页连接和新子页。旧项目首次读取历史或变更前惰性补当前 `initial` 基线，相同内容不会重复留版。快照排除父子树、工作流、原始输入与凭据；图片只记录项目内不可变资产引用。Postgres 不主动裁剪版本，删除项目通过外键一并删除版本和恢复幂等记录。

恢复合并以当前有效连接目标为准，不复活旧目标、不删除已有子页，也不修改父节点、层级或运行状态。历史中没有的已连接区块/热点继续保留；有内容变化的恢复追加版本，并清除旧人工核对声明。历史中的旧 provenance 来自服务端记录的历史，可以恢复，但混合页面没有区块级出处。版本不替代数据库与 `data/` 备份；整树时间回滚和多人协作不在当前范围。

## 固定版本发布与独立 reader

编辑管理接口均包含 `/api`，仅在可信编辑服务开放：

| 接口 | 合约 |
|---|---|
| `POST /projects/{pid}/publications` | 严格 JSON `{operation_id, expected_revision}`；201 新发布 / 200 幂等重放，返回 `{publication}` |
| `GET /projects/{pid}/publications` | `{publications}`，包含已撤下记录；源项目删除后仍可查询 |
| `GET /publications` | 全局发布记录，作品库用于管理删源后的固定版本 |
| `DELETE /projects/{pid}/publications/{id}` | 幂等撤下，返回 `{publication}`；错误归属 404 |

摘要为 `{id, project_id, name, source_revision, created_at, page_count, content_hash, state, url}`，`state` 为 `published` / `withdrawn`。操作 ID 规则和恢复相同；新发布需非负预期修订。相同操作与修订返回原回执，撤下后重放不会重新上线；参数不同 409。活动任务、陈旧修订、不完整树或缺失图片返回 409；阅读器未构建返回 503。并发文件锁忙返回 503 和 `Retry-After`，客户端必须保留原操作及修订重试，不能按内容冲突另建发布。发布不写页面/历史/任务，也不调用模型。

可信播放器需 Node.js 24 构建一次（在根目录执行），Compose 已自动构建：

```sh
npm --prefix frontend ci
npm --prefix frontend run build:publication
# 独立终端，无需 DATABASE_URL / 模型 Key；默认 http://localhost:8081
cd backend
uvicorn reader:app --host 127.0.0.1 --port 8081
```

本地默认发布目录是仓库 `data/publications/`，可用 `PUBLICATION_DIR` 覆盖；可信产物默认 `backend/publication_runtime/`，可用 `PUBLICATION_RUNTIME_DIR` 覆盖。编辑后端加载 `.env`，reader 故意不加载，独立启动需在环境中明确设置目录。`PUBLICATION_BASE_URL` 是链接的完整公开服务地址，不是浏览器编辑地址。

reader 不导入 main/database/jobs，不连接 Postgres；只挂发布目录读权限，仅开放 `/p/{id}/` 及精确资源白名单的 GET/HEAD 和 `/healthz`。图片、正文和播放器均复制到各自固定目录；源图片删除和后续升级不改变旧发布。私有清单不对读者开放。撤下后未来请求 404，已下载或已渲染的内容无法追回。发布目录的锁和 rename 需要支持 POSIX flock/原子目录 rename 的本地文件系统；本轮不支持跨机器多写入者或对象存储。

公开部署的 Compose 快速开始与 reader 地址配置见[根说明](../README.md#阅读与导出)；独立发布和进程验收命令统一见[验证说明](../docs/VERIFICATION.md#真实进程验收)。

## 持久生成接口

以下路径均包含 `/api` 前缀，成功接收返回 **202 + 任务 snapshot**：

| 入口 | 请求 |
| --- | --- |
| 根页文字/图片 | `POST /projects/{pid}/analysis-jobs`，multipart：`operation_id`、可选 `text`、`keywords`（逗号分隔）、`file`、原始文件 `file_sha256`、`generate_images` |
| 子页 | `POST /projects/{pid}/nodes/{nid}/generation-jobs`，JSON：`operation_id`、`selected_keywords`、可选`generate_images` |
| 单页再生 | `POST /projects/{pid}/nodes/{nid}/regeneration-jobs`，JSON：`operation_id`、`generate_images` |

`generate_images` 冻结本次出图意图，恢复时丢失临时 Key 不会改变它。根页上传先实际解码、规范化为不可变 PNG 并保存，再在事务中写入 job/事件/DBOS 队列。原文件 hash 与规范化资产 hash 分别记录；工作流只携带本地资产引用，不序列化文件、multipart 或原始凭据。应答丢失后优先查询 operation；原操作已接收时，可用相同文件摘要和原文字参数重放而不重复上传。

Snapshot 的 `kind` 为 `children`、`analyze` 或 `regenerate`，旧记录默认 `children`。空根页任务的 `node_id` 为 null，`target_node_id` 是预留的稳定根节点 ID；只有成功提交才创建节点。`input_summary` 为非秘密白名单。终态应重新读取项目，不把事件里的半个节点直接覆盖编辑状态。

再生完成前只改变运行状态，不替换原标题、说明和图片；失败或取消恢复原状态。已有热点或 `scene_document` 返回409。未知再生出图不提供「保留文字」决定，取消即可保留旧页；未知根页出图可保留分析文字，状态为 `partial` 并附说明。确定图片的定位可以放弃，随后手动添加热点。

旧 `/generate-children` 保留持久任务的 SSE 适配器，请使用稳定 `x-operation-id`。**旧 `/analyze` 与 `/regenerate` 地址均升级为202任务协议，分别不再返回原 SSE 和同步终态节点**；旧客户端需查询任务或迁移到新接口，仍支持 `x-operation-id`。旧 `children-v1` workflow 的名称与步骤序列保留，新入口使用独立 `root-analysis-v1` / `regenerate-v1` 名称；本轮没有宣称解决跨版本任意代码迁移。

当前浏览器、进程恢复及整栈验收统一见[验证说明](../docs/VERIFICATION.md)；更早结果从[历史索引](../docs/archive/README.md)查阅。
