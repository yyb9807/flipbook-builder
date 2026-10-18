# 第三轮持久任务扩展设计与协议

> 历史记录（2026-10-18）。本文保留当时状态；当前实现与可运行命令见[文档导航](../README.md)和[验证说明](../VERIFICATION.md)。旧 PoC / 36 场景 CLI 已退役。

2026-10-18。先补齐第二轮浏览器验收，再实施本设计。本文先于生产修改形成；浏览器旧子页闭环通过后，根页和再生后端已按下述方案接入。后端全量真实 Postgres 测试 180/180 通过（41.46 秒），含新流程凭据回显扫描；真实进程故障验收仍在进行。本文不替代最终实施报告和验收证据。

当前具体协议：`analysis-jobs` 使用 multipart `operation_id,text,keywords,file,file_sha256,generate_images`；关键词为逗号分隔文本，`file_sha256` 是原始字节 SHA256。`regeneration-jobs` 使用 JSON `{operation_id,generate_images?}`。出图意图缺省按首次图片 Key 是否存在冻结，重放缺省复用原意图。图片输入始终复用原上传资产。已接收图片操作允许只传同一 `file_sha256` 而不再上传 File；仍须文字、关键词、供应商公开配置和出图意图完全匹配。

旧 `/analyze` 和 `/regenerate` 路径现在都返回 **202 + task snapshot**，接受稳定 `x-operation-id`；不再返回请求内执行的 SSE/同步最终结果。新客户端统一查询任务和订阅 events。子页旧 SSE 适配继续保留。再生对任何已有热点或非 null `scene_document` 返回 409；再生图片结果未知不提供 accept，明确取消保留原页。上述为实际实现选择，后文提出的旧 analyze SSE 等备选不适用本轮最终协议。

## 现状与约束

`jobs/workflows.py` 的 `children-v1` 已将规划、出图、定位、提交拆为检查点。业务 attempt 先写远端调用意图，临时凭据只在进程内；未知结果需要明确决定。第二轮已用真实 Postgres、DBOS 和正式 Agent 连接假供应商验收。

根页 `POST /projects/{id}/analyze` 仍在 SSE 请求内执行；单页 `/regenerate` 仍同步等待生成。二者都有请求断开和进程重启时丢失工作的问题。根页还可能没有任何 node，现有 `generation_jobs.node_id NOT NULL REFERENCES nodes` 无法表达此状态。再生目前会在出图失败时继续改写文字，此行为不应延续到新流程。

这轮不修改旧 `children-v1` 的检查点调用顺序、名称、参数或返回结构。保持 DBOS `application_version="children-v1"` 和队列消费版本，注册额外命名 workflow。应用版本与业务 kind 是不同概念，不能为了新功能随意改版本，导致旧队列无法恢复。

## 公共协议

沿用现有查询、事件、凭据和决定协议：

| 操作 | 建议接口 |
| --- | --- |
| 建立根页任务 | `POST /projects/{pid}/analysis-jobs`，multipart：`operation_id`、`text`、`keywords`、可选 `file`；202 |
| 建立单页再生任务 | `POST /projects/{pid}/nodes/{nid}/regeneration-jobs`，JSON：`operation_id`；202 |
| 子页任务 | 保持现有 `generation-jobs` 接口 |
| 恢复发现 | 保持 `/projects/{pid}/jobs?active=...&operation_id=...` |
| 任务操作 | 保持 `/jobs/{id}`、`events`、`credentials`、`retry`、`accept`、`cancel` |

公开 snapshot 追加 `kind: children | analyze | regenerate`。已有数据默认 `children`。`node_id` 允许 null，仅用于根页尚未提交阶段；追加 `target_node_id` 是预先冻结的目标 ID，根页提交时才产生真正 node。它在提交前不能设指向 nodes 的外键。再生与子页 task 的 `node_id` 保持原含义。

追加白名单 `input_summary`，至少包含 `source_type`、`input_sha256`、显示标题、`image_requested`；若需要原文件重选可含 `file_sha256`（原始上传字节 hash）、文件名和长度，不包含原始图片、凭据或供应商请求对象。原文件 hash 与规范化 PNG hash 不可混同。前端只有 File 对象时可以用 WebCrypto 计算原文件 hash；文件本体不写 localStorage。

保留 `result.nodes/warnings/failed_hotspot_ids` 三字段，避免所有旧读者立即改判别。根页结果可追加原分析响应必需的 `node_id/summary/main_objects/scene_type/image_url/source_type/hotspots/keywords`；再生结果可追加原再生响应字段。新客户端以 kind 决定终态文案，终态统一重新读取 project，而不是手工拼装半个 node。

## 幂等与输入冻结

操作 ID 是作品级唯一。先查同操作，再做「已有 root」「已有热点」「正在生成」等会被自身成果改变的前置判断；这样成功和取消后的重放仍能找到原任务。相同操作 ID、不同 kind 或不同输入返回 409，不允许借重试偷偷改变收费输入。

根页先读大小受限文件、实际解码校验并规范化成 PNG，计算输入身份，保存不可变资产，然后才原子写业务 job、事件和 DBOS 入队。冻结输入只保存本地资产 URL/hash，不将 multipart、UploadFile、bytes、base64 或 Key 传入 DBOS。每次恢复读资产路径并验证存在和 hash；丢失资产是清晰的本地失败，不能把它伪装成远端超时并重新出图。

fingerprint 至少覆盖 kind、目标、规范化文字、关键词、真实上传 hash、供应商公开地址/模型与初始出图意图。settings 在首次接收时冻结；重放用原输入，不读取后来变化的项目配置。初次提交有 image key 则冻结 `image_requested=true`；以后 vault 缺 Key 必须等待，不得把「丢 Key」解释为「选择不出图」。

文件系统和 PG 无法跨介质事务。采用「先完成不可变资产，后 PG 入队」；事务失败或重复请求遗留的未引用文件只需后续垃圾回收，不阻断恢复。优先使用内容地址或先查已有 operation 避免重复写资产；不能在重试时覆盖原 URL。接收失败不得遗留已入队但资产半写的 job。

浏览器先成功创建项目、收到 project_id 后立即打开 `{root_node_id:null,nodes:{}}` 并持久保存 pending，再提交 analysis job。create-project 本身丢响应可能留下无收费的空作品；本轮可将其作为已知边界，不为此引入全局分析 endpoint。analysis 提交应答丢失，先按 operation 查询，确实未接收才复用原 operation 重传。原 File 丢失需要重新选择并匹配 hash，不能把新文件套到旧 operation。

## 数据库与锁

采用可重复执行的追加迁移：

```sql
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'children';
ALTER TABLE generation_jobs ALTER COLUMN node_id DROP NOT NULL;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS target_node_id TEXT;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS input_summary JSONB NOT NULL DEFAULT '{}';
```

现有 node 外键保留，null 自然满足。现有 attempts/decisions 的 `hotspot_id TEXT` 没有外键，可在新 workflow 内用稳定的 subject token（如 `root` 或 `node:<id>`）作为 stage 身份，不创建假的热点记录；代码和公开确认文案应明确它不是可点击热点。若新增通用 subject 字段可以追加，不必重命名旧列。

这轮统一**同一作品至多一个新活动任务**。所有 admission 在 project row `FOR UPDATE` 下查询 active jobs；提交、取消、删除、编辑遵循 `project → node（若存在）→ job` 的一致锁顺序。现有大部分路径是 node→job，不能只给新流程在 node 之后补 project 锁，否则可能形成死锁。更改存储锁顺序不改变旧 DBOS workflow 步骤序列。

暂不盲目创建 project 级 active unique index：旧版本允许不同 node 上同时存在活跃任务，新增索引会使升级直接失败。统一 admission 的项目锁已能串行排他；已有旧活跃任务继续逐个恢复和完成，期间拒绝任何新任务。若要后续添加唯一索引，必须等旧 cohort 清空，不能在迁移时擅自取消收费任务。原 node 级唯一索引仍有效。

PATCH node、增改热点、删除作品也在同一作品锁后检查 active，和前端目前锁整份作品的行为一致。新 root 没有 node 时也能保护项目删除。cancel、commit 的检查和写入在同一事务内；取消先赢则任何晚到结果只可保存在 attempt，不能发布页面。

## 新工作流

新增模块（例如 `jobs/page_workflows.py`），显式注册 `root-analysis-v1` 与 `regenerate-v1`。共享 intent/vault/本地 DB retry 的机制，避免把新 kind 分支插入旧 `children-v1` 的控制流。不要修改旧 workflow 的 step 序列来「复用更多代码」。

根页步骤：

1. `load`：读取冻结 input，校验资产引用，稳定 root ID 已在 admission 分配。
2. `analysis`：一次 `InputAnalysisAgent.analyze_image/analyze_text`；`safe_errors=True`，业务 intent 和完成结果均持久化。
3. `composition`：独立检查点。纯函数规范化构图类型、主题与标签、组装图片提示；不再次调用供应商。当前 analyze_text 内也组装提示，可暂保留其兼容字段，但新 workflow 明确以此步输出为准。
4. `image`：仅 text 且 `image_requested` 时执行 `single_attempt=True`；图片输入直接引用上传资产。生成资产不可变。
5. `localize`：图片上传分析已给有效热点时复用该分析，不为了形式多调一次 VLM；独立本地检查点保存 sanitize 结果。文字生成封面则对真实新图做一次受 intent 保护的定位。无图时返回空热点，无假坐标。
6. `commit-root`：project 锁 + job 锁，确认未取消、仍无 root，幂等插入冻结 node ID、热点、root 引用与结果。成功后重复提交复用原节点；若发现别的 root，不覆盖它，转明确冲突失败。
7. `finish`：清 vault，终态描述根页成果；空热点只产生可操作警告。

单页再生步骤：

1. admission 锁 project/node，冻结当前页、父页、关联主题、settings 和 `previous_status`，稳定目标仍为原 node ID。存在任何热点立即 409，保护坐标和子页链接；也不得处理已活动任务。
2. `plan`：一次 PageGenerationAgent；结果保存在 attempt，尚不改原页面内容。
3. `composition`：独立纯检查点，规范化规划输出与生成提示，不调用模型。
4. `image`：有出图意图则 `single_attempt=True,use_cache=False`；禁止隐藏 SDK 重试或 Flux 参数降级二次请求。初始没有出图意图时，是否保留旧图片必须明确冻结，不能由恢复时 Key 是否存在推断。
5. `localize`：对确定的新图片定位；若复用原图，标签必须明确这是原图定位而非新图。失败/放弃定位可保存新图并给「稍后手动添加热点」警告。
6. `commit-regenerate`：重新检查任务未取消、页版本仍冻结版本、仍无热点；同事务更新内容、图片和新热点，写完整结果。节点 ID 不变，失败前原 title/description/image_url/scene_document 均不动。
7. `finish`：释放状态和 vault。cancel/失败只恢复 previous_status，不能把原内容换成半成品。

再生的 scene_document 应作为冻结原内容保护，不能保留一份与新生成文字无关的旧结构化正文。提交时需明确选用「保留旧结构化正文且只更新插图」或「用户明确重新生成整页、原 scene_document 清空」之一；建议本轮对结构化场景页拒绝整页再生，提示直接编辑或新建版本，避免隐性丢正文。若保留支持，应在按钮说明和测试中明确，而不是无声混合两版内容。

## 错误、确认与凭据

复用现有 vault：配置/Key 只在请求或进程内；任何 DBOS 函数参数、返回、error、日志与事件均不能含 secrets。Agent 成功输出也可能回显 Key，继续在进入检查点前统一 redact 所有该任务 secrets。新 stage 不要把原 SDK exception 交给 DBOS 序列化。

独立审查补充了「进程中断后的未确认调用 + 相关本地图片同时丢失」交叉故障：不能因图片缺失而把旧 `started` intent 终态失败并解除保护。实际实现现在在统一锁内先检查 attempt：`started` 进入 `waiting_confirmation / phase=recovery`，明确本地图片缺失且上次可能已计费，禁用 retry/accept，只允许核实后取消；已完成 attempt 复用已知成果，最终提交仍检查图片 hash；无未确认调用才明确 `local_asset_unavailable`。这三种分支均有真实 Postgres 回归。

每次远端调用前先持久 started intent；完成后先写业务结果，再让 DBOS checkpoint。重启遇已完成 attempt 复用结果，遇 started 转 waiting_confirmation。未知分析/规划不允许 accept；未知出图的 accept 语义按 kind 区分：新根页可「保留分析文字，不生成封面」，再生建议不提供该 accept（保留旧页需直接取消），避免部分失败覆盖旧页。未知定位可「保留确定图片，手动添加热点」。retry 只在明确确认后增加 attempt。

再生已知出图失败应结束失败并保留原页面，不延续旧同步路由「捕获异常后照样改文字」行为。新根页已知出图失败可以保留已完成文字并警告，但需在结果中如实表明缺封面。是否将状态标 partial 或 succeeded+warning 要统一，不能前端宣称全部生成成功。本地磁盘校验和业务提交错误不触发远端重新计费；真实未知窗口仍保守等待确认。

## 旧 API 适配

旧 analyze 路径保留 multipart 接收与 `x-operation-id`，只建立或找到持久任务，然后把公共事件转换为原 SSE step/done 字段。断开只断订阅，不能取消执行；实际任务不放 BackgroundTasks，也不依赖路由 generator 生命周期。

旧 regenerate 路径保持地址、输入和 operation 幂等，但建议升级为 202 + 公共 snapshot/任务引用；客户端需查询。若一定保留同步终态 JSON，则仍需等待任务完成，它与「立即返回异步确认」不能同时成立。不能把二者都写成已兼容。正式前端改用新 regeneration-jobs 接口，文档说明旧路径响应升级；旧 terminal operation 重放可直接返回原终态结果。

## 文件边界与测试

- `schema.sql`：追加迁移；重复执行与旧数据兼容。
- `jobs/models.py,store.py,service.py`：kind/公共摘要、根页入队、再生入队、项目锁、commit/fail/cancel kind 语义；保持旧步骤行为。
- 新 `jobs/page_workflows.py`：新两种 workflow；新增 provider adapter 阶段，所有一次调用边界可单测。
- `routers/jobs.py`：新建立接口；`routers/projects.py,nodes.py`：薄旧 API adapter 和作品级写保护。
- 前端：判别 task kind、空项目工作台/恢复页、analysis multipart pending 与响应丢失发现、再生异步提交和统一终态读取。

必须新增真实 PG 测试：schema 重复应用、null node root 接收/取消、operation 冲突/终态重放、原子入队回滚、跨 node/kind 并发排他、删除/编辑/提交锁竞争、根页稳定 ID 和单次热点插入、再生有热点 409、失败/取消不改原内容、原 scene 内容保护。

必须新增真实进程验收：图片与文字根页、再生三种入口，分析/构图/出图/定位/提交各边界 SIGKILL 恢复，内存 Key 丢失/重供，已完成业务成果在 DBOS checkpoint 之前重放，unknown retry/accept/cancel，晚到结果不发布，root_node_id null 重启，断 SSE/刷新不取消，重复 operation 不重发请求，旧 children-v1 活动任务升级恢复。继续扫描 PG 表、DBOS pickle/Base64、dump、日志与资产，包含负控。

浏览器验收先补旧子页的提交→刷新→供 Key→恢复→预览/导出→取消完整按钮路径，再验新根页和再生同样路径。对真实付费模型质量仍不作未经调用的承诺；本轮假供应商替代远端，正式 Agent/HTTP/Postgres/DBOS 和 UI 均用生产实现。
