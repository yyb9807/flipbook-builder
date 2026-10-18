# 子页面持久生成接入计划

> 历史记录（2026-10-18）。本文保留当时状态；当前实现与可运行命令见[文档导航](../README.md)和[验证说明](../VERIFICATION.md)。旧 PoC / 36 场景 CLI 已退役。

状态：**原始接入设计，核心已实施并完成真实验收**。本计划基于原 children SSE 流程、独立 DBOS PoC、本地已安装的 `dbos==3.3.0` 源码制定。按顺序先通过 Postgres 整栈再实施；当前实现、修复与限制以[第二轮实施报告](ROUND_2_IMPLEMENTATION.md)和[17场景验收](DURABLE_GENERATION_VERIFICATION.md)为准。

## 范围与保证

将“选中热点 → 生成子页面”迁移到持久任务。浏览器只订阅状态，刷新或断开订阅不取消任务。已完成步骤在进程重启后复用；每个子页面独立提交，其他页面失败不回滚成功页面。远程服务与数据库不能构成同一事务，不能承诺付费调用恰好一次：不确定结果先暂停，再由用户明确重试、接受已有成果或取消。

这不是账户/权限系统。继续以可信的单实例自托管为边界。第一版固定单个 executor，禁止用同一个 executor ID 同时启动多个进程；跨实例临时凭据路由及滚动升级另外设计。

## API 与快照

| 接口 | 约定 |
|---|---|
| `POST /projects/{pid}/nodes/{nid}/generation-jobs` | body `{operation_id, selected_keywords}`，AI 配置只经显式请求头读取；返回 `202 JobSnapshot`。相同操作 ID、相同输入返回已有任务；不同输入返回 409。 |
| `GET /projects/{pid}/jobs?active=true` | 返回当前作品未结束任务；刷新时恢复 UI，无需 Key。 |
| `GET /jobs/{jid}` | 获取完整快照，无需 Key。 |
| `GET /jobs/{jid}/events?after={id}` | 只读 SSE。每条有 `id:` 和完整快照；同时支持 `Last-Event-ID`，游标取明确规则，拒绝负数/非法值。心跳不插数据库。断连只关闭订阅。 |
| `POST /jobs/{jid}/credentials` | 用户显式提供所需 AI 请求头，只写进程内 vault。地址/模型必须与冻结的配置一致，避免把新 Key 发给任务原先以外的服务。返回快照，不回显 Key。 |
| `POST /jobs/{jid}/retry` | body `{confirmation_id}`；明确允许该不确定阶段再次调用、可能重复计费。无 Key；缺 Key 时转等待凭据。旧/已消费确认 ID 拒绝或幂等返回，不得开启第二次尝试。 |
| `POST /jobs/{jid}/accept` | body `{confirmation_id}`；出图阶段可接受已完成文字页，定位阶段可接受图片但无热点。没有规划成果时不可接受。不要把“接受”解释为远端一定成功。 |
| `POST /jobs/{jid}/cancel` | 幂等持久取消意图；成功子页保留。明确说明无法撤销已发送请求的费用。 |

建议快照：

```ts
{
  job_id, operation_id, project_id, node_id,
  status, phase, message, pct, last_event_id,
  result: { nodes, warnings, failed_hotspot_ids } | null,
  error: { code, message } | null,
  provider_config: { llm_base_url, llm_model, imggen_base_url, imggen_model },
  required_credentials: ('llm' | 'imggen')[],
  confirmation: { id, stage, hotspot_id, message, can_accept, accept_label } | null,
  created_at, updated_at
}
```

`status` 使用 `queued/running/waiting_credentials/waiting_confirmation/cancelling/succeeded/partial/failed/cancelled`。允许查询快照始终包含已提交子页；终态由子页集合汇总，失败不是泛化成功。第一版按冻结热点顺序逐页执行，只有一个当前确认；等待决策时后续页暂不启动，已经完成的子页保持可用。`pct` 来自已完成阶段计数，不能用等待秒数伪造进度。

## 表与操作幂等

新增表（名称可在实施时调整，children 这里指业务子页面，不要求额外 DBOS child workflow）：

- `generation_jobs`：job ID，操作 ID，作品/父页外键，类型，输入 fingerprint，冻结的非秘密输入快照和 provider 元数据，原父页状态，公开状态/结果/错误，cancel_requested，时间戳。`UNIQUE(project_id, operation_id)`。对未结束任务加父页部分唯一索引，一个父页只有一个活动生成任务。
- `generation_children`：`(job_id, hotspot_id)` 唯一，稳定 child node ID，冻结热点标签/父页文本/深度/设置，阶段状态和非秘密成果引用。child node ID 在提交时确定并保存，恢复时不能重新随机生成。
- `generation_attempts`：`(job_id, hotspot_id, stage, attempt_no)` 唯一，随机 request ID，`started/completed/unknown/failed/accepted`，开始/完成时间，成果或公开错误。阶段包含 `plan/image/localize`。每次远端调用前先提交 intent；DBOS 检查点不是唯一防线。
- `generation_decisions`：确认 ID、目标 attempt、唯一 action、消费标识和时间戳。通过比较并交换防止重复点击/重放使 attempt_no 增加两次。
- `generation_events`：全局递增 event ID，job ID，唯一 event_key，完整公开快照 JSON，时间戳。快照更新和事件插入在同一业务事务。事件允许 ID 有间隙，不允许倒序或重复 key。

请求 fingerprint 只包含规范化且稳定的请求字段（operation_id 的作用域、selected_keywords）及非秘密 provider 配置，不含可变热点状态、Key、请求头或任意 `Request` 对象；创建时另存冻结的热点 ID/标签、父页内容和设置作为工作输入。重复提交必须先按 operation ID 查既有任务并比较请求 fingerprint，再判断父页 generating；不得重新读取已经被该任务修改的 status/updated_at 或目标链接计算请求 fingerprint，否则响应丢失后的同 ID 重试会错误冲突。

## DBOS 执行与 Postgres 一致性

第一版采用**一个异步 job workflow 按冻结顺序逐页执行**，不为吞吐量增加并行子流程和多确认聚合。workflow 只接收 job ID，读取冻结输入的操作是一个步骤。每页执行 `plan → image → localize → commit`，每项是独立真实 `@DBOS.step(retries_allowed=False)`；不能将 `_build_child()` 整块包装成一个步骤。已知失败记录该 hotspot 后继续下一页，不确定结果则暂停当前 job。每次提交更新 result.nodes，保留逐页 partial 成果。future 并行化需要另行验证确定性和多确认 UI。

DBOS 3.3.0 的异步初次启动在当前 loop 建任务；恢复/队列启动会提交至 launch 时捕获的主 loop。必须在 FastAPI 异步 lifespan 的运行中主 loop 调用 `DBOS.launch()`，随后异步 workflow/step 才能复用同一 loop 创建的 asyncpg pool。不要在线程里 launch 后把主 loop 的 asyncpg pool 交给恢复流程，也不要在同步 DBOS step 内 `asyncio.run()` 使用该 pool。[3.3.0 event loop 源码](https://github.com/dbos-inc/dbos-transact-py/blob/3.3.0/dbos/_event_loop.py)、[恢复与异步启动源码](https://github.com/dbos-inc/dbos-transact-py/blob/3.3.0/dbos/_core.py)

DBOS `system_database_url` 指向**同一个 Postgres 数据库**，系统表用 `dbos` schema。应用业务表继续原 schema。版本固定为 `children-v1`，单实例 executor 固定名称；变更 workflow 步骤顺序时保留旧函数/版本，不通过随意更改版本号“解决”恢复失败。

在 DBOS 初始化/迁移/恢复之前，另开专用 Postgres 连接持有固定 application/executor 对应的 `pg_try_advisory_lock`。获取失败立即启动失败，不让两个服务恢复同一 executor；部署明确 `uvicorn --workers 1`，不使用多个副本。连接在整个服务生命周期持有，关闭 DBOS 后才释放。锁连接断开时立即将 service 标为停止、拒绝提交、取消本地运行协程并终止/重启进程；每个远端调用及业务提交前再检查停止标识，不能失锁后继续当执行器。重启发现已发送 intent 按未知结果处理。集成测试要同时启动第二个进程并断言它在任何 provider 调用前被拒绝。

DBOS 3.3.0 提供 `DBOSClient.enqueue_in_transaction()` 和 `send_in_transaction()`，接受调用方持有的同步 SQLAlchemy Connection/Session；它们不能直接接收 asyncpg Connection。建议仅任务提交和用户决策使用小范围 SQLAlchemy + psycopg 同步事务，经 `asyncio.to_thread` 调用；其他业务节点写入保留 asyncpg。

同一 SQLAlchemy 事务锁父页、核验热点/深度、创建 jobs/children/首事件、将父页设为 generating、`enqueue_in_transaction(..., workflow_id=job_id)`。事务提交前 executor 看不到任务，失败则一起回滚。这样没有“业务任务已创建，DBOS 尚未接收就崩溃”的空隙。已有相同操作 ID 直接返回，不再次 enqueue；这里不使用事务入队不支持的 `duplication_policy='return-existing'`。队列和 workflow_name 必须显式注册并固定。[DBOSClient 3.3.0 源码](https://github.com/dbos-inc/dbos-transact-py/blob/3.3.0/dbos/_client.py)

凭据/决策恢复通知也优先用 `send_in_transaction`，消息仅含决策 ID或无秘密的“凭据有变化”。不要直接改 DBOS 私有表。业务写入和步骤检查点仍然是两个事务，所以业务提交必须幂等：锁任务取消标识和父热点，已有目标则返回同一个节点；新节点+热点+父热点绑定+child成功+job聚合事件一起提交。步骤返回前崩溃时，重放查询已提交成果即可，不重复插页。

关闭服务时先停止接收新任务，协作取消本地运行协程但保留可恢复的非终态，不把关闭服务记为用户取消；等待持久写入，销毁 DBOS，然后关闭 asyncpg pool。同步 destroy/join 放 `to_thread`，主 loop 保持运转；shutdown 不应阻塞 loop 等待依赖该 loop 的 workflow。

## 临时凭据与等待

vault 只在进程内，以 job ID 及 provider 绑定。Key 不进入 workflow/step 的参数、返回值、消息、事件、异常、日志或 traces。TTL/容量有上限，终态主动清除；关闭服务清空。初次请求在调用 DBOS 之前把 Key 放 vault。系统或任务 JSON 中只保存地址、模型及本次是否请求出图这一布尔意图，不保存 Key 的散列、尾号或原始 headers。

缺 Key 时 provider step 返回无秘密的 `need_credentials`，workflow 用 `await DBOS.recv_async(topic='credentials')` 等待通知；通知不带 Key。收到后开始下一个 step occurrence，在 provider step 内再次读取 vault，结果不含 Key。不能把“取 Key”做成返回秘密的 checkpoint step，也不能复用已经 checkpoint 为 need_credentials 的同一个步骤位置期望它自动重跑。通知被消费后立刻又崩溃也必须能再次停下等待新凭据。等待用 async durable receive，不用 PoC 的 `threading.Condition.wait` 占线程。

`credentials` 接口先写 vault，再提交无秘密通知。重启会丢失 Key，这是预期行为。若初次未选择出图，继续允许文字页，不在恢复时凭空要求图片 Key。

## 不确定远端结果

每个付费远端阶段先查 intent/result。已完成则返回保存的成果；`started` 无成果则转 waiting_confirmation，不自动再调用。只有创建新 intent 的这一执行拥有发送请求的权利。远端返回并保存本地成果后，才返回 DBOS step。意图已写但请求还没发出的崩溃窗口也保守暂停。

现有 ImageGenerationAgent 会对超时/断连/5xx 自动重试，OpenAI SDK 也有默认重试。持久流程必须调用单次请求模式并设置 SDK `max_retries=0`；否则 intent 护栏内仍会重复付费。既有 root/regen 默认重试行为可暂保留，新增显式参数供持久流程关闭。Flux 的参数降级请求同样要么明确限制为已收到确定的参数拒绝，要么纳入新的尝试。

超时、连接断开、5xx、进程被杀都不能推断远端未计费。4xx 已知失败可显示公开错误，重新提供 Key/重试也必须经过明确状态转换。异常只保存 allowlist 错误 code 和固定文案；不要将 httpx/OpenAI 原始异常、response body 或 request 对象交给 DBOS 序列化。日志也不能直接 `str(error)`，防止供应商回显秘密。图片缓存命中是本地结果，不应制造付费 intent。

accept 只消费已有检查点成果，不伪造远端图片：image 阶段未知时生成文字页及 warning，localize 阶段未知时保留图片及空热点。取消持久记录意图，立即清理 vault；任何晚到结果在写入作品前必须按统一顺序锁 job/父页，在同一事务内再检查取消，不能覆盖取消状态。成功子页保留，未提交资产可延后回收。

## 编辑并发与旧接口

活动任务期间父页保持 generating，现有 PATCH/热点添加/regen 继续 409，防止冻结的热点标签、坐标和父文案漂移；完成的子页可单独编辑。提交和取消都以父页+job锁为一致顺序，防止多次提交/新任务交错。项目删除先锁该作品所有活动任务并请求取消，或返回明确409要求先取消；第一版推荐返回409以避免级联删除使未完成远端调用失去追踪。删除后 worker 不得重新创建作品目录或成为无限重试任务。

旧 `generate-children` SSE 可在完成前端切换后变为持久任务的兼容适配：创建/复用任务后订阅事件，把 snapshot.result 转成旧 done payload。适配器断连不再取消业务任务；前端“取消”必须改为显式 POST cancel。上传分析与 regen 暂保留旧行为，并在文档写清恢复范围。

## 文件边界

- `backend/jobs/{models,store,credentials,providers,workflows,service}.py`：数据契约、事务、vault、单次供应商调用、DBOS 编排和集成。
- `backend/routers/jobs.py`：请求校验、快照/事件/决策 HTTP 边界，不包含模型执行。
- `backend/schema.sql`：可重复运行的增量表/索引；DBOS 自己迁移系统 schema。
- `backend/main.py`：同 loop lifespan 初始化/关闭；`requirements*.txt` 固定 DBOS 和 psycopg。
- `backend/agents/image_generation.py`：兼容的 single-attempt 参数；如必要为 LLM 错误日志加固定文案模式。
- `frontend/api/client.ts`、任务 store/hook、任务状态面板：提交 ID 在发请求前持久；恢复查询/SSE 不发 Key；只有明确凭据操作发 Key；retry/accept/cancel 分离。

## 验收

1. 先跑真实 Postgres 全量旧测试、重复 schema、真实前后端 nginx/容器路由及上传/CRUD/导出边界，保留可重跑命令。
2. 真实 Uvicorn 子进程 + Postgres + 本地 HTTP 假供应商；走正式 API 和实际 agents，不把 fake backend 当作集成。至少覆盖两个热点、真实 PNG、定位坐标和逐页落库。
3. plan 检查点后 SIGKILL → 重启缺 Key等待 → 显式提供 Key → 完成；image 检查点后再杀进程，重启不能再调该 image。记录供应商实际调用次数和本地节点唯一数。
4. HTTP 假供应商成功/响应断开窗口杀进程；重启停待确认，无自动第二次调用；分别验 retry、accept、cancel，校验旧确认 ID 不可重复消费。
5. 一页失败另一页成功；刷新/SSE断开/游标重连；模拟202响应丢失，同 operation ID 在 parent generating 时仍取回原任务，不同稳定输入409；多并发请求只创建一个活动任务；编辑冲突409；取消与晚到结果争用（取消完成后绝无新节点/链接）；项目删除不能遗留活动付费 workflow；提交事务后 DBOS checkpoint 前崩溃无重复节点；重复/过期 confirmation 不得多次增加 attempt 或调用供应商。
6. 重启时检查 event loop 标识和 asyncpg pool 所属 loop 一致；同一 Postgres 中事务 rollback 不留下 job/DBOS孤儿；服务关闭不把所有活动任务改取消。
7. 假 Key 经管道/请求头传入，不写测试 argv/env；扫描业务表、DBOS inputs/output/error/notifications 及日志，含 Base64 解码负控。真实 provider 全部不发付费请求。CI 跑 Postgres API测试；重启故障注入按可控隔离测试入口运行，不能在生产暴露测试 gate。

实施完成后另写实测报告；不能将本设计的保证当成已经通过的验收结论。
