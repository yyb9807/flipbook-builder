# 第二轮持久生成独立代码复核

> 历史记录（2026-10-18）。本文保留当时状态；当前实现与可运行命令见[文档导航](../README.md)和[验证说明](../VERIFICATION.md)。旧 PoC / 36 场景 CLI 已退役。

日期：2026-10-18。复核对象是本轮持久子页生成接入及其并发边界，不是将上一轮大量未提交改动全部视为本轮新增代码。未改动生产实现；确认问题交由对应实现者修复，再独立复验。

**最终结论：确认的 4 个 P2 均已修复并独立复验；复核范围内没有未解决的 P1/P2。**

## 范围与方法

先阅读 `ROUND_2_PLAN.md`、`DURABLE_INTEGRATION_PLAN.md`、`DURABLE_GENERATION_VERIFICATION.md`，再检查：

- `backend/jobs/*`：事务入队、稳定输入、单次远端 intent、检查点复用、凭据等待、确认消费、取消/提交锁序、内部错误投影和执行器生命周期。
- `backend/routers/jobs.py`、`schema.sql`、`main.py`、项目删除保护及旧 `generate-children` 适配。
- agents 的 `single_attempt`、SDK `max_retries=0`、公开错误与结果脱敏。
- 前端 job client/store/hooks/panel，以及任务锁、页面同步、草稿和保存重试的交互。

使用专用随机数据库运行正式 FastAPI/DBOS 回归；管理连接仅用于创建和删除本次新库，没有清空共享表。真实进程复验使用本地 HTTP 假供应商，没有真实付费请求，也没有终止正在供浏览器验收使用的 8000 端口 demo。

## 确认的问题与修复

### R2-01 · P2 · 旧 SSE 入口拒绝同一操作的恢复订阅（已解决）

修复前 `backend/routers/nodes.py:274-275` 在调用持久 `service.submit` 前先拒绝父页 `generating`。因此旧客户端携带相同 `x-operation-id` 断线重发时得到 409，无法重新订阅已有任务；新 job API 的相同操作重放正常返回 202。

独立隔离 PG 复现得到：legacy 重放 409“这个页面正在生成”，新 API 重放 202 且 job ID 相同。修复将有稳定操作 ID 的 durable 分支移到可变页面/热点预检查之前，并复用独立 SSE 适配器；无稳定 ID 的兼容路径仍保留原有检查。

已独立运行 `test_legacy_stable_operation_replays_active_and_terminal_before_prechecks`：活动任务可以继续订阅；任务终止后即使热点选择已变化，也能重放同一历史操作。通过。

### R2-02 · P2 · 多任务终态同步提前解除作品编辑锁（已解决）

修复前 `frontend/src/hooks/useGenerationJobs.ts` 用单个作品布尔值表示多个独立 job 的同步状态。后端仅限制同一父页一个活动任务，不同父页/不同浏览器标签可产生多个任务。两个终态 GET 同时进行时，第一个完成便设置 `syncing=false`；另一个旧 GET 仍可能在用户恢复编辑后覆盖本地项目。

修复后 `projectRefreshQueues` 按作品串行 GET/apply，`syncHolders` 按 job/event/workspace 签名持有同步锁；全部请求完成前不提前解锁，失效 workspace 不能覆盖当前项目。独立复读实现并运行对应受控回归：第一次 GET 完成后仍锁定，第二次完成后才解除，最终保留最新读取值。通过。

### R2-03 · P2 · 活动 SSE 阻止正常 SIGTERM 进入生命周期清理（已解决）

修复前 Docker、README 和进程验收入口均以 Uvicorn 默认的无限 graceful wait 启动。持久任务等待凭据时 SSE 可长时间保持打开；SIGTERM 会先等待活动 HTTP 连接，而 `JobService.stop()` 要在后续 lifespan 关闭阶段才执行。独立真进程复现中，SIGTERM 后保持订阅至少 5 秒未退出，关闭客户端后再等待 5 秒仍停在 `Waiting for connections to close`，测试最终需要强制结束。

修复为生产 Docker、文档命令和真实验收入口统一配置 `--timeout-graceful-shutdown 5`。独立复验保持客户端订阅打开，只发送 SIGTERM：5.266 秒完成 `Application shutdown complete`，没有 SIGKILL；任务在库中仍为 `running`。重启后同一 job 在 image 阶段等待凭据，显式补 Key 后成功，plan/image 各调用 1 次，生成节点 1 个。

当前 Uvicorn 在完成清理后会重抛 SIGTERM，子进程正常返回码可为 `-15`；验收同时检查完整关闭日志和恢复行为，没有将该返回码当作执行器失败。可保存证据见 [独立停机复验](evidence/round-2-review-graceful-20261018.json)。

### R2-04 · P2 · 失败保存重试可穿过同步锁并留下错误的“已保存”画面（已解决）

修复前位置为 `frontend/src/hooks/useBuilderActions.ts:254-260`、`frontend/src/pages/BuilderPage.tsx:67`。`retryPending()` 没有遵守任务编辑锁，错误 notice 的“重试保存”按钮也位于禁用编辑区之外。触发条件是：本标签的节点 PATCH 失败并保留 pending；另一标签运行任务；当前标签收到终态后发起延迟的项目 GET；用户在 `syncing=true` 时重试保存。

独立临时 Vitest 的两个完成顺序均复现：服务器已保存重试的新值，`projectStore` 却被终态 GET 恢复成旧值，`saveStatus='saved'`，pending 队列已清空，任务锁释放，同一 job 也不再触发 GET。页面和导出可使用旧内容，服务器中的成功保存值仍存在。

仅禁用重试按钮不足以完整修复：终态 GET 本身可能先覆盖失败 pending 的乐观状态，之后解锁重试若只写 API，仍不会恢复本地值。最终修复同时约束重试 handler 和按钮，并在成功后回放仍为最新、且属于原项目/原 workspace revision 的编辑字段；热点回放合并当前对象，保留任务新生成的 `target_node_id` 与 `score`。BuilderPage 按项目 ID 重挂载，避免跨项目复用 pending 闭包。

独立补验临时 suite 6/6 通过：节点/热点同步锁内不发重试，解锁成功后服务器与画面一致；保留终态新链接及 score；节点/热点的迟到结果均不能覆盖不同项目或同项目重新打开后的新 workspace。正式五个回归及前端全量 136 项也由主审再次执行通过。前后临时测试均已从仓库删除；可重用代码与原始证据分别保留于 `/tmp/flipbook-retry-save-race.acceptance.test.tsx`、`/tmp/flipbook-retry-save-race.acceptance-evidence.txt`。

## 独立执行的回归

- 专用 PG 库 `flipbook_review_9b7e9eae8982`：5/5 通过，涵盖 legacy 活动/终态重放、unknown 确认只消费一次、本地瞬时写入失败不重调供应商、ERROR 未确认 intent 保持锁、成功回显与异常不 checkpoint Key。库已删除。可重跑包装脚本与原始输出分别为 `/tmp/flipbook_review_backend_checks.py`、`/tmp/flipbook_review_backend_checks.txt`。
- 前端四个核心 job 测试文件先独立通过 20/20；R2-04 修复后再次独立执行 `npm test`，最终 **22 文件、136/136 通过**，包括事件解析/无 Key 请求、操作引用持久化、终态同步锁、任务面板和失败保存重试。
- 正式 Uvicorn + PG + HTTP 假供应商的有界停机和重启：通过；独立库 `flipbook_acceptance_f9c44f4c0d30` 已删除。证据 JSON 和日志位置保存在上述停机复验记录中。
- 失败保存重试竞争：独立临时受控 Vitest 2/2 复现，修复后另一独立临时 suite **6/6 通过**；覆盖节点/热点、同步锁、成功值回放、新子页链接/score、跨项目及同项目新 workspace 的迟到结果。

这里没有把其他执行者的全量后端、17 场景恢复验证或浏览器检查写成“本独立审查重新执行过”。全量恢复/凭据扫描证据及其覆盖边界见 [持久生成验收](DURABLE_GENERATION_VERIFICATION.md)；最终整栈结果由对应报告记录。

## 结论边界

远端请求前持久 intent、未知结果等待明确决策、关闭 SDK/应用自动重试、确认消费幂等，以及取消和子页提交的共同锁序，在本次复核路径中没有发现可确认的重复收费或取消后重新发布子页问题。本地数据库重试只包裹本地操作；已保存的远端结果不会因该重试重新发送。

这不构成真实供应商计费或所有 SDK 未来行为的证明。仅覆盖单执行器、自托管、同版本恢复；不覆盖多副本凭据路由、滚动升级或跨版本 workflow 迁移。正常有界关闭依赖已配置 5 秒 graceful wait 的受支持启动命令。

前端本轮有意采用整作品活动任务编辑锁，已提交子页在终态统一刷新；不宣称运行中可以实时编辑部分成果。DBOS 已进入 ERROR 且有未确认 intent 时保留保护，只允许核实后明确取消再重建，尚不支持直接修复错误步骤继续。根页上传分析和旧 regenerate 不具备本轮子页任务的同等持久恢复契约。
