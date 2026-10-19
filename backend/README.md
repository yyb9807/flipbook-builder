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

- 默认免账号、单实例共享工作区。能访问编辑 API 的人能够操作其中的作品；只读浏览地址不构成访问权限隔离。
- 供应商的 URL、Key、model 作为一组选择。请求带任意一项供应商配置头时，整个供应商使用请求配置，缺少的 Key 保持空；只有完全没有该组配置头时，才使用部署环境配置。
- 自定义 HTTP(S) 地址支持本地模型。服务地址不能包含 URL 凭据、查询参数或片段。不要对不受信任的访客公开持有部署密钥的编辑实例。
- 图片上传最多 20 MB，只接受实际可解码的 JPG、PNG、WEBP 静态图，最大 4000 万像素、单边 12000 像素。服务器统一重编码为 PNG、去除元数据并生成不可变文件地址；ASGI 层另设 22 MB 总请求限额，在 multipart 解析前限制带或不带 Content-Length 的请求。不能仅凭文件后缀或 MIME 判断图片安全。
- `PATCH /api/projects/{project_id}/nodes/{node_id}` 修改标题、说明、可选的 `scene_document` 与节点级 `content_metadata`。SceneDocument v1支持`atlas`/`sequence`和最多12个分区；新增区块原子创建真实section连接，回填hotspot_id，改名同步连接；有子页的区块不能直接删除或改指目标。设scene为null只有不破坏已链接区块时才允许。API返回规范scene、hotspots和metadata，客户端应采用真实连接ID。
- `POST /api/projects/{project_id}/nodes/{node_id}/hotspots` 在图片模式中手动添加矩形热点；最多12个，返回选中但未链接的热点，不伪造模型置信度。结构化知识页返回409，应通过正文区块建立连接。`kind=section`的位置、尺寸与评分为空；旧记录默认`kind=image`，保留原几何。
- 新主题页、子页和可再生旧页使用同一次内容模型调用输出标题、导读和1–6个解释区块，后端严格校验，ID与目标由服务端建立。新任务冻结`knowledge-v1`/`image-v1`；无marker的历史任务沿用旧路径和checkpoint步序。知识页可不出图，有图也不额外定位；上传图片继续使用分析中的真实图像坐标。旧无marker流程仍保留真实图像定位，非法或失败结果为空，不补假评分。
- `content_metadata` v1包含服务端provenance（AI输入类型及模型）、最多12条作者references（标题≤200字、可选URL≤2000字、说明≤1000字）与review_status。URL仅允许无凭据的绝对HTTP(S)，不自动抓取。编辑不允许新增/修改/删除服务端provenance；正文、资料或热点文字变化清除旧核对，作者可以同批明确重新声明。模型回复的来源、核实声明和链接身份均被忽略，不能把格式通过当作事实核实。
- 子页生成逐页提交，单个子页失败时保留已完成的其他子页并返回 `warnings`、`failed_hotspot_ids`。重新尝试会跳过已有目标页面的热点。有任何热点或结构化正文的页面禁止整页重新生成，防止破坏坐标、导航与作者内容；尚未实现版本比较与关联重定位。
- 三种生成均接入 DBOS 3.3.0 与真实 Postgres，创建接口见下表。`GET /api/projects/{pid}/jobs?active=true`、`GET /api/jobs/{jid}` 和 `/events?after={event_id}` 读取恢复状态，不发送 Key。`active=false&operation_id=...` 精确找回初次响应丢失的操作。SSE 断开只断订阅；显式 `/cancel` 才取消业务任务。
- 单个任务按选中连接顺序逐页规划、可选出图和提交，各远端阶段checkpoint；仅旧图片流程执行定位。业务任务创建和DBOS入队在同一个Postgres事务；正文、连接、来源及进度也在短事务内幂等提交。已完成页面不会因另一页失败而丢失；重复提交先查既有操作，再检查父页状态。正文格式错误是已知失败，不自动重新付费生成。
- 原始 Key 仅存进程内 vault，30 分钟过期、最多 100 份，取消/终态清理。重启后需要 Key 的阶段会暂停，用户通过 `/credentials` 显式提供与原服务地址/模型绑定的凭据；不能把 Key 放进 DBOS 参数、消息、结果或日志。DBOS 默认 Base64 序列化不是加密，作品内容与公开 provider 元数据仍是数据库中的普通应用数据。
- 所有持久流程的远端调用只尝试一次，关闭 Agent、SDK 与 Flux 参数降级重试。远端成功但本地结果丢失时暂停待确认，`/retry` 明确允许可能重复计费的下一次尝试；`/accept` 可保留已完成文字页或已有图片，`/cancel` 保留成功页面。接口使用单次 `confirmation_id`，过期/重复确认不会重复调用。
- 普通数据库连接/序列化/死锁错误只重试本地写入，不重新调用供应商。极端执行器代码错误且仍有未确认 intent 时，任务保持锁定、禁止再次调用，显示 `can_retry=false`；需核实后明确取消再重建，暂不自动修复已经失败的 DBOS step。取消无法撤销供应商已收到请求的费用。
- 同一作品的新活动任务互斥。编辑、热点写入与删除在 project → node → job 一致锁顺序下检查活动任务，返回409时需先完成或取消任务。升级前已存在的不同节点并行任务继续恢复，不通过新增唯一索引或擅自取消来清理。独立 PoC 与旧 36 场景 CLI 已退役，仅保留历史记录；当前进程验证使用 `scripts/verify_knowledge_generation.py`。
- 新前端离线导出复用共享 React 播放器。后端 `export.zip` 保留兼容，安全嵌入数据并降级展示结构化页面的文字和链接；JSON 导出保留原始结构化数据。

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

浏览器与真实进程验收见[第五轮报告](../docs/ROUND_5_IMPLEMENTATION.md)和[当前验证说明](../docs/VERIFICATION.md)；第三轮记录保留为旧合约历史证据。
